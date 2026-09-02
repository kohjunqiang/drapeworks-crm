"use server";

import "server-only";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireRole, requireSession } from "@/lib/auth/require-role";
import { db } from "@/lib/db/kysely";
import type { FulfilmentStatus } from "@/lib/db/schema";
import { STATUS_FLOW, leadMilestoneForOrderStatus } from "@/lib/status-flow";

const advanceSchema = z.object({
  orderId: z.string().uuid(),
  expectedStatus: z.custom<FulfilmentStatus>(
    (value) =>
      typeof value === "string" &&
      STATUS_FLOW.includes(value as FulfilmentStatus),
    "Order status invalid",
  ),
  note: z.string().max(2000).optional(),
});

export async function advanceOrderStatus(input: unknown) {
  const session = await requireRole(["ops", "admin"]);
  const parsed = advanceSchema.parse(input);

  const linkedLeadId = await db.transaction().execute(async (trx) => {
    const order = await trx
      .selectFrom("orders")
      .select(["current_status", "appointment_id", "lead_id"])
      .where("id", "=", parsed.orderId)
      .forUpdate()
      .executeTakeFirst();
    if (!order) throw new Error("Order not found");
    if (order.current_status !== parsed.expectedStatus) {
      throw new Error("Order status already changed. Refresh and try again.");
    }

    const idx = STATUS_FLOW.indexOf(order.current_status);
    if (idx === -1) throw new Error("Order status invalid");
    if (idx === STATUS_FLOW.length - 1) throw new Error("Already completed");
    if (order.current_status === "delivered_checked") {
      throw new Error(
        "Arrange the installation date before moving to Fulfillment Arrangement",
      );
    }

    const next = STATUS_FLOW[idx + 1];
    const fallbackLeadId = !order.lead_id && order.appointment_id
      ? (
          await trx
            .selectFrom("appointments")
            .select("lead_id")
            .where("id", "=", order.appointment_id)
            .executeTakeFirst()
        )?.lead_id
      : undefined;
    const leadId = order.lead_id ?? fallbackLeadId;
    const linkedLead = leadId
      ? await trx
          .selectFrom("leads")
          .select(["id", "funnel_stage"])
          .where("id", "=", leadId)
          .forUpdate()
          .executeTakeFirst()
      : undefined;

    await trx.insertInto("order_status_events").values({
      order_id: parsed.orderId,
      status: next,
      note: parsed.note?.trim() || null,
      created_by: session.user.id,
    }).execute();
    const milestone = leadMilestoneForOrderStatus(next);
    if (linkedLead && milestone) {
      await trx.updateTable("leads").set({
        funnel_stage: milestone.stage,
        last_outcome: milestone.outcome,
        ...(next === "quotation_sent" ? { quotation_sent_at: new Date() } : {}),
        updated_at: new Date(),
      }).where("id", "=", linkedLead.id).execute();
      if (linkedLead.funnel_stage !== milestone.stage) {
        await trx.insertInto("lead_stage_events").values({
          lead_id: linkedLead.id,
          from_stage: linkedLead.funnel_stage,
          to_stage: milestone.stage,
          changed_at: new Date(),
          changed_by: session.user.id,
          source: "system",
        }).execute();
      }
    }
    return linkedLead?.id ?? null;
  });

  revalidatePath(`/orders/${parsed.orderId}`);
  revalidatePath("/orders");
  if (linkedLeadId) {
    revalidatePath("/leads");
    revalidatePath(`/leads/${linkedLeadId}`);
  }
}

const noteSchema = z.object({
  orderId: z.string().uuid(),
  note: z.string().min(1, "Note required").max(2000),
});

export async function addStatusNote(input: unknown) {
  const session = await requireSession();
  const parsed = noteSchema.parse(input);

  const order = await db
    .selectFrom("orders")
    .select(["current_status", "consultant_id"])
    .where("id", "=", parsed.orderId)
    .executeTakeFirst();
  if (!order) throw new Error("Order not found");

  const role = session.profile.role;
  const isOwner = order.consultant_id === session.user.id;
  if (!(role === "ops" || role === "admin" || (role === "consultant" && isOwner))) {
    throw new Error("Forbidden");
  }

  await db
    .insertInto("order_status_events")
    .values({
      order_id: parsed.orderId,
      status: order.current_status,
      note: parsed.note.trim(),
      created_by: session.user.id,
    })
    .execute();

  revalidatePath(`/orders/${parsed.orderId}`);
}

const revertSchema = z.object({
  orderId: z.string().uuid(),
  reason: z.string().min(1, "Reason required").max(2000),
});

export async function revertOrderStatus(input: unknown) {
  const session = await requireRole(["admin"]);
  const parsed = revertSchema.parse(input);

  const order = await db
    .selectFrom("orders")
    .select("current_status")
    .where("id", "=", parsed.orderId)
    .executeTakeFirst();
  if (!order) throw new Error("Order not found");

  const idx = STATUS_FLOW.indexOf(order.current_status);
  if (idx <= 0) throw new Error("Cannot revert further");

  const prev = STATUS_FLOW[idx - 1];

  // An arrangement at Delivered & Checked can exist after reverting once from
  // Fulfillment Arrangement. Do not hide it by reverting farther while its
  // Google event remains active.
  if (order.current_status === "delivered_checked") {
    const arrangement = await db
      .selectFrom("fulfilment_arrangements")
      .select(["id", "cancelled_at", "google_event_id"])
      .where("order_id", "=", parsed.orderId)
      .executeTakeFirst();
    if (arrangement && !arrangement.cancelled_at) {
      throw new Error(
        "This order still has an installation booking. Cancel it before reverting farther.",
      );
    }
    if (arrangement?.cancelled_at && arrangement.google_event_id) {
      throw new Error(
        "The cancelled installation is still pending Calendar removal. Retry Calendar sync before reverting farther.",
      );
    }
  }

  await db
    .insertInto("order_status_events")
    .values({
      order_id: parsed.orderId,
      status: prev,
      note: `[REVERTED] ${parsed.reason.trim()}`,
      created_by: session.user.id,
    })
    .execute();

  revalidatePath(`/orders/${parsed.orderId}`);
  revalidatePath("/orders");
}
