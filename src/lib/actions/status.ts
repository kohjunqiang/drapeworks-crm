"use server";

import "server-only";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireRole, requireSession } from "@/lib/auth/require-role";
import { db } from "@/lib/db/kysely";
import { STATUS_FLOW } from "@/lib/status-flow";

const advanceSchema = z.object({
  orderId: z.string().uuid(),
  note: z.string().max(2000).optional(),
});

export async function advanceOrderStatus(input: unknown) {
  const session = await requireRole(["ops", "admin"]);
  const parsed = advanceSchema.parse(input);

  const order = await db
    .selectFrom("orders")
    .select("current_status")
    .where("id", "=", parsed.orderId)
    .executeTakeFirst();
  if (!order) throw new Error("Order not found");

  const idx = STATUS_FLOW.indexOf(order.current_status);
  if (idx === -1) throw new Error("Order status invalid");
  if (idx === STATUS_FLOW.length - 1) throw new Error("Already completed");

  const next = STATUS_FLOW[idx + 1];

  await db
    .insertInto("order_status_events")
    .values({
      order_id: parsed.orderId,
      status: next,
      note: parsed.note?.trim() || null,
      created_by: session.user.id,
    })
    .execute();

  revalidatePath(`/orders/${parsed.orderId}`);
  revalidatePath("/orders");
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
