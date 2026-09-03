"use server";

import "server-only";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireRole } from "@/lib/auth/require-role";
import { db } from "@/lib/db/kysely";
import { loadOrderShipmentState } from "@/lib/logistics/load";
import {
  hasExactShipmentCategories,
  requiresLocalDelivery,
  SHIPMENT_CATEGORIES,
  validateAllShipmentsArrived,
  validateShipmentNumbersForTransition,
} from "@/lib/logistics/shipments";
import { statusIndex } from "@/lib/status-flow";

const optionalNumber = z.string().max(200).nullable()
  .transform((value) => value?.trim() || null);
const shipmentSchema = z.object({
  category: z.enum(SHIPMENT_CATEGORIES),
  localDeliveryNumber: optionalNumber,
  overseasFreightNumber: optionalNumber,
  expectedUpdatedAt: z.coerce.date(),
});
const schema = z.object({
  orderId: z.string().uuid(),
  shipments: z.array(shipmentSchema).max(SHIPMENT_CATEGORIES.length),
});

export async function saveDeliveryNumbers(input: unknown): Promise<void> {
  await requireRole(["ops", "admin"]);
  const parsed = schema.parse(input);

  await db.transaction().execute(async (trx) => {
    const order = await trx.selectFrom("orders")
      .select("current_status")
      .where("id", "=", parsed.orderId)
      .forUpdate()
      .executeTakeFirst();
    if (!order) throw new Error("Order not found");
    if (statusIndex(order.current_status) < statusIndex("sent_logistic")) {
      throw new Error(
        "Local delivery numbers are recorded when the order is sent to the logistic partner.",
      );
    }

    const state = await loadOrderShipmentState(trx, parsed.orderId);
    if (state.categories.length === 0) {
      throw new Error("No shipment orders found. Review the vendor orders first.");
    }
    const receivedCategories = parsed.shipments.map((shipment) => shipment.category);
    if (!hasExactShipmentCategories(state.categories, receivedCategories)) {
      throw new Error("Shipment categories changed. Refresh and try again.");
    }

    const overseasRequired =
      statusIndex(order.current_status) >= statusIndex("shipping_sg");
    if (
      overseasRequired &&
      !parsed.shipments.some((shipment) => shipment.overseasFreightNumber)
    ) {
      throw new Error("Enter an overseas freight number for at least one shipment.");
    }
    for (const shipment of parsed.shipments) {
      const existing = state.shipments.find(
        (row) => row.category === shipment.category,
      );
      const localChanged = requiresLocalDelivery(shipment.category) &&
        shipment.localDeliveryNumber !== existing?.localDeliveryNumber;
      const overseasChanged = overseasRequired &&
        shipment.overseasFreightNumber !== existing?.overseasFreightNumber;
      if ((localChanged || overseasChanged) &&
        new Date(existing?.updatedAt ?? 0).getTime() !==
          shipment.expectedUpdatedAt.getTime()) {
        throw new Error(
          "Shipment numbers were updated by someone else. Refresh and try again.",
        );
      }
      if (existing?.arrivedCheckedAt && (localChanged || overseasChanged)) {
        throw new Error(
          `Reopen the arrival check for ${shipment.category} before changing its tracking numbers.`,
        );
      }
      if (requiresLocalDelivery(shipment.category) && !shipment.localDeliveryNumber) {
        throw new Error(`Enter the local delivery number for ${shipment.category}.`);
      }
      if (!overseasRequired && !requiresLocalDelivery(shipment.category)) {
        continue;
      }

      await trx.insertInto("order_shipments").values({
        order_id: parsed.orderId,
        category: shipment.category,
        local_delivery_number: requiresLocalDelivery(shipment.category)
          ? shipment.localDeliveryNumber
          : state.shipments.find((row) => row.category === shipment.category)
              ?.localDeliveryNumber ?? null,
        overseas_freight_number: overseasRequired
          ? shipment.overseasFreightNumber
          : null,
        source: "derived",
      }).onConflict((conflict) => conflict
        .columns(["order_id", "category"])
          .doUpdateSet({
          ...(requiresLocalDelivery(shipment.category)
            ? { local_delivery_number: shipment.localDeliveryNumber }
            : {}),
          ...(overseasRequired
            ? { overseas_freight_number: shipment.overseasFreightNumber }
            : {}),
          source: "derived",
        }))
        .execute();
    }
  });

  revalidatePath(`/orders/${parsed.orderId}`);
}

const arrivalsSchema = z.object({
  orderId: z.string().uuid(),
  arrivals: z.array(z.object({
    category: z.enum(SHIPMENT_CATEGORIES),
    arrivedChecked: z.boolean(),
    expectedUpdatedAt: z.coerce.date(),
  })).max(SHIPMENT_CATEGORIES.length),
  note: z.string().trim().max(2000).optional(),
  markDelivered: z.boolean().default(false),
}).refine((value) => value.arrivals.length > 0 || value.markDelivered, {
  message: "No arrival changes were submitted.",
});

export async function saveShipmentArrivals(
  input: unknown,
): Promise<{ delivered: boolean }> {
  const session = await requireRole(["ops", "admin"]);
  const parsed = arrivalsSchema.parse(input);

  await db.transaction().execute(async (trx) => {
    const order = await trx.selectFrom("orders")
      .select("current_status")
      .where("id", "=", parsed.orderId)
      .forUpdate()
      .executeTakeFirst();
    if (!order) throw new Error("Order not found");
    if (order.current_status !== "shipping_sg") {
      throw new Error(
        "Arrival progress can only be changed while the order is Shipping to SG.",
      );
    }

    const state = await loadOrderShipmentState(trx, parsed.orderId);
    if (state.categories.length === 0) {
      throw new Error("No shipment orders found. Review the vendor orders first.");
    }
    const submittedCategories = parsed.arrivals.map((arrival) => arrival.category);
    if (new Set(submittedCategories).size !== submittedCategories.length ||
      submittedCategories.some((category) => !state.categories.includes(category))) {
      throw new Error("Shipment orders changed. Refresh and try again.");
    }

    const now = new Date();
    for (const arrival of parsed.arrivals) {
      const existing = state.shipments.find(
        (shipment) => shipment.category === arrival.category,
      );
      if (!existing) throw new Error("Shipment order not found");
      if (new Date(existing.updatedAt).getTime() !== arrival.expectedUpdatedAt.getTime()) {
        throw new Error(
          "Shipment arrival progress was updated by someone else. Refresh and try again.",
        );
      }
      if (arrival.arrivedChecked && !existing.overseasFreightNumber?.trim()) {
        throw new Error(
          `Enter the overseas freight number for ${arrival.category} first.`,
        );
      }
      const wasArrived = Boolean(existing.arrivedCheckedAt);
      if (wasArrived === arrival.arrivedChecked) continue;
      if (wasArrived && !parsed.note) {
        throw new Error("Add a reason when reopening an arrival check.");
      }

      await trx.updateTable("order_shipments").set({
        arrived_checked_at: arrival.arrivedChecked ? now : null,
        arrived_checked_by: arrival.arrivedChecked ? session.user.id : null,
        arrival_note: parsed.note || null,
      }).where("order_id", "=", parsed.orderId)
        .where("category", "=", arrival.category)
        .executeTakeFirstOrThrow();
      await trx.insertInto("order_shipment_events").values({
        order_id: parsed.orderId,
        category: arrival.category,
        event_type: arrival.arrivedChecked
          ? "arrival_recorded"
          : "arrival_reopened",
        note: parsed.note || null,
        created_by: session.user.id,
      }).execute();
    }

    if (parsed.markDelivered) {
      const refreshed = await loadOrderShipmentState(trx, parsed.orderId);
      const numberError = validateShipmentNumbersForTransition(
        refreshed.categories,
        refreshed.shipments,
        "overseas",
      );
      if (numberError) throw new Error(numberError);
      const arrivalError = validateAllShipmentsArrived(
        refreshed.categories,
        refreshed.shipments,
      );
      if (arrivalError) throw new Error(arrivalError);
      await trx.insertInto("order_status_events").values({
        order_id: parsed.orderId,
        status: "delivered_checked",
        note: parsed.note || "All shipments arrived and checked",
        created_by: session.user.id,
      }).execute();
    }
  });

  revalidatePath(`/orders/${parsed.orderId}`);
  revalidatePath("/orders");
  return { delivered: parsed.markDelivered };
}

const reopenArrivalSchema = z.object({
  orderId: z.string().uuid(),
  category: z.enum(SHIPMENT_CATEGORIES),
  expectedUpdatedAt: z.coerce.date(),
  reason: z.string().trim().min(1, "Reason required").max(2000),
});

export async function reopenShipmentArrival(input: unknown): Promise<void> {
  const session = await requireRole(["admin"]);
  const parsed = reopenArrivalSchema.parse(input);

  await db.transaction().execute(async (trx) => {
    const order = await trx.selectFrom("orders")
      .select("current_status")
      .where("id", "=", parsed.orderId)
      .forUpdate()
      .executeTakeFirst();
    if (!order) throw new Error("Order not found");
    if (order.current_status !== "delivered_checked") {
      throw new Error(
        "Revert the order to Delivered & Checked before reopening an arrival.",
      );
    }
    const shipment = await trx.selectFrom("order_shipments")
      .select(["arrived_checked_at", "updated_at"])
      .where("order_id", "=", parsed.orderId)
      .where("category", "=", parsed.category)
      .executeTakeFirst();
    if (!shipment?.arrived_checked_at) {
      throw new Error("This shipment is not marked as arrived.");
    }
    if (new Date(shipment.updated_at).getTime() !== parsed.expectedUpdatedAt.getTime()) {
      throw new Error(
        "Shipment arrival progress was updated by someone else. Refresh and try again.",
      );
    }
    await trx.updateTable("order_shipments").set({
      arrived_checked_at: null,
      arrived_checked_by: null,
      arrival_note: parsed.reason,
    }).where("order_id", "=", parsed.orderId)
      .where("category", "=", parsed.category)
      .executeTakeFirstOrThrow();
    await trx.insertInto("order_shipment_events").values({
      order_id: parsed.orderId,
      category: parsed.category,
      event_type: "arrival_reopened",
      note: parsed.reason,
      created_by: session.user.id,
    }).execute();
    await trx.insertInto("order_status_events").values({
      order_id: parsed.orderId,
      status: "shipping_sg",
      note: `Arrival reopened for ${parsed.category}: ${parsed.reason}`,
      created_by: session.user.id,
    }).execute();
  });

  revalidatePath(`/orders/${parsed.orderId}`);
  revalidatePath("/orders");
}
