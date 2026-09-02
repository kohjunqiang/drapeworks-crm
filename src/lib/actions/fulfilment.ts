"use server";

import "server-only";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth/require-role";
import { syncFulfilmentArrangement } from "@/lib/calendar/fulfilment-sync";
import { db } from "@/lib/db/kysely";
import {
  fulfilmentArrangementRetrySchema,
  fulfilmentArrangementSchema,
} from "@/lib/validation/fulfilment";

const sgInstant = (date: string, time: string) =>
  new Date(`${date}T${time}:00+08:00`);

function refresh(orderId: string): void {
  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/orders");
}

export async function saveFulfilmentArrangement(input: unknown): Promise<void> {
  const session = await requireRole(["ops", "admin"]);
  const parsed = fulfilmentArrangementSchema.parse(input);
  const scheduledAt = sgInstant(parsed.date, parsed.time);

  const arrangementId = await db.transaction().execute(async (trx) => {
    const order = await trx
      .selectFrom("orders")
      .select("current_status")
      .where("id", "=", parsed.order_id)
      .forUpdate()
      .executeTakeFirst();
    if (!order) throw new Error("Order not found");
    if (!["delivered_checked", "fulfilment"].includes(order.current_status)) {
      throw new Error(
        "Installation can only be arranged after delivery has been checked",
      );
    }

    const arrangement = await trx
      .insertInto("fulfilment_arrangements")
      .values({
        order_id: parsed.order_id,
        scheduled_at: scheduledAt,
        duration_mins: parsed.duration_mins,
        address: parsed.address,
        google_sync_state: "pending",
        google_sync_error: null,
        created_by: session.user.id,
      })
      .onConflict((conflict) =>
        conflict.column("order_id").doUpdateSet({
          scheduled_at: scheduledAt,
          duration_mins: parsed.duration_mins,
          address: parsed.address,
          google_sync_state: "pending",
          google_sync_error: null,
        }),
      )
      .returning("id")
      .executeTakeFirstOrThrow();

    // Booking is the structured action that moves Delivered & Checked into the
    // Fulfillment Arrangement stage. It cannot be skipped by a generic advance.
    if (order.current_status === "delivered_checked") {
      await trx
        .insertInto("order_status_events")
        .values({
          order_id: parsed.order_id,
          status: "fulfilment",
          note: `Installation booked for ${parsed.date} ${parsed.time}`,
          created_by: session.user.id,
        })
        .execute();
    }
    return arrangement.id;
  });

  await syncFulfilmentArrangement(arrangementId);
  refresh(parsed.order_id);
}

export async function retryFulfilmentSync(input: unknown): Promise<void> {
  await requireRole(["ops", "admin"]);
  const parsed = fulfilmentArrangementRetrySchema.parse(input);
  const arrangement = await db
    .selectFrom("fulfilment_arrangements")
    .select("id")
    .where("order_id", "=", parsed.order_id)
    .executeTakeFirstOrThrow();
  await syncFulfilmentArrangement(arrangement.id);
  refresh(parsed.order_id);
}
