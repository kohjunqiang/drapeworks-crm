"use server";

import "server-only";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth/require-role";
import { syncFulfilmentArrangement } from "@/lib/calendar/fulfilment-sync";
import { db } from "@/lib/db/kysely";
import {
  fulfilmentArrangementCancellationSchema,
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

    const previousArrangement = await trx
      .selectFrom("fulfilment_arrangements")
      .select(["id", "cancelled_at"])
      .where("order_id", "=", parsed.order_id)
      .executeTakeFirst();

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
          cancelled_at: null,
          cancelled_by: null,
          cancellation_reason: null,
        }),
      )
      .returning("id")
      .executeTakeFirstOrThrow();

    await trx
      .insertInto("fulfilment_arrangement_events")
      .values({
        arrangement_id: arrangement.id,
        event_type:
          !previousArrangement || previousArrangement.cancelled_at
            ? "booked"
            : "rescheduled",
        scheduled_at: scheduledAt,
        duration_mins: parsed.duration_mins,
        address: parsed.address,
        cancellation_reason: null,
        created_by: session.user.id,
      })
      .execute();

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

export async function cancelFulfilmentArrangement(input: unknown): Promise<void> {
  const session = await requireRole(["ops", "admin"]);
  const parsed = fulfilmentArrangementCancellationSchema.parse(input);

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
        "Installation can only be cancelled before the order is completed",
      );
    }

    const arrangement = await trx
      .selectFrom("fulfilment_arrangements")
      .select([
        "id",
        "cancelled_at",
        "scheduled_at",
        "duration_mins",
        "address",
      ])
      .where("order_id", "=", parsed.order_id)
      .executeTakeFirst();
    if (!arrangement || arrangement.cancelled_at) {
      throw new Error("There is no active installation booking to cancel");
    }

    await trx
      .updateTable("fulfilment_arrangements")
      .set({
        cancelled_at: new Date(),
        cancelled_by: session.user.id,
        cancellation_reason: parsed.reason,
        google_sync_state: "pending",
        google_sync_error: null,
      })
      .where("id", "=", arrangement.id)
      .execute();

    await trx
      .insertInto("fulfilment_arrangement_events")
      .values({
        arrangement_id: arrangement.id,
        event_type: "cancelled",
        scheduled_at: arrangement.scheduled_at,
        duration_mins: arrangement.duration_mins,
        address: arrangement.address,
        cancellation_reason: parsed.reason,
        created_by: session.user.id,
      })
      .execute();

    // The booking is the action that entered Fulfillment Arrangement, so its
    // cancellation returns the order to Delivered & Checked with an audit note.
    if (order.current_status === "fulfilment") {
      await trx
        .insertInto("order_status_events")
        .values({
          order_id: parsed.order_id,
          status: "delivered_checked",
          note: `[INSTALLATION CANCELLED] ${parsed.reason}`,
          created_by: session.user.id,
        })
        .execute();
    }

    return arrangement.id;
  });

  const result = await syncFulfilmentArrangement(arrangementId);
  refresh(parsed.order_id);
  if (!result.ok) {
    throw new Error(
      "Installation cancelled, but its Calendar event could not be removed. Retry Calendar sync from the order.",
    );
  }
}

export async function retryFulfilmentSync(input: unknown): Promise<void> {
  await requireRole(["ops", "admin"]);
  const parsed = fulfilmentArrangementRetrySchema.parse(input);
  const arrangement = await db
    .selectFrom("fulfilment_arrangements")
    .select("id")
    .where("order_id", "=", parsed.order_id)
    .executeTakeFirstOrThrow();
  const result = await syncFulfilmentArrangement(arrangement.id);
  refresh(parsed.order_id);
  if (!result.ok) {
    throw new Error(
      "Calendar sync failed again. The installation change is still saved.",
    );
  }
}
