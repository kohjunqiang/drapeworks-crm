import type { Kysely, Transaction } from "kysely";

import type { DB, FulfilmentStatus } from "@/lib/db/schema";
import { STATUS_FLOW, statusIndex } from "@/lib/status-flow";

import { usableFreightNumber } from "./freight";

type Executor = Kysely<DB> | Transaction<DB>;

const ARRIVAL_NOTE =
  "Auto-reconciled: every required shipment arrived and checked.";
const BOOKING_NOTE = "Auto-reconciled: an installation booking is active.";

export type FulfilmentReconcileResult = {
  from: FulfilmentStatus;
  to: FulfilmentStatus;
  emitted: FulfilmentStatus[];
};

/**
 * Catch an order's status up to its recorded facts. Once every required
 * shipment is arrived and checked the order belongs at Delivered & Checked —
 * or Fulfillment Arrangement when an installation booking is already active.
 *
 * Status is event-sourced and ose_validate_transition only accepts one step at
 * a time, so intermediate milestones are emitted as audited catch-up events in
 * order. Shipment and booking timestamps are facts and stay untouched; only the
 * status log advances. The caller must hold (or take) the orders row lock so a
 * concurrent writer cannot interleave a different transition mid-walk.
 *
 * Deliberately conservative: orders before Sent to Vendor have no shipment
 * manifest to trust, Delivered & Checked and beyond are already at or past the
 * target, and an empty or fully not-needed manifest never advances.
 */
export async function reconcileFulfilmentStatus(
  executor: Executor,
  input: {
    orderId: string;
    createdBy: string | null;
    /** Audit note for the fulfilment event, e.g. "Installation booked for …". */
    fulfilmentNote?: string;
    /** Prepended to generated notes, e.g. "[REPAIR] " for operator repairs. */
    notePrefix?: string;
  },
): Promise<FulfilmentReconcileResult> {
  const order = await executor
    .selectFrom("orders")
    .select("current_status")
    .where("id", "=", input.orderId)
    .forUpdate()
    .executeTakeFirst();
  if (!order) throw new Error("Order not found");

  const from = order.current_status;
  const fromIdx = statusIndex(from);
  const done = (
    emitted: FulfilmentStatus[] = [],
  ): FulfilmentReconcileResult => ({
    from,
    to: emitted.length ? emitted[emitted.length - 1] : from,
    emitted,
  });

  if (
    fromIdx < statusIndex("sent_to_vendor") ||
    fromIdx > statusIndex("delivered_checked")
  ) {
    return done();
  }

  const shipments = await executor
    .selectFrom("order_shipments")
    .select(["not_needed", "overseas_freight_number", "arrived_checked_at"])
    .where("order_id", "=", input.orderId)
    .execute();
  const required = shipments.filter((shipment) => !shipment.not_needed);
  const allArrived =
    required.length > 0 &&
    required.every(
      (shipment) =>
        shipment.arrived_checked_at !== null &&
        usableFreightNumber(shipment.overseas_freight_number) !== null,
    );
  if (!allArrived) return done();

  const booking = await executor
    .selectFrom("fulfilment_arrangements")
    .select("id")
    .where("order_id", "=", input.orderId)
    .where("cancelled_at", "is", null)
    .executeTakeFirst();

  const targetIdx = statusIndex(booking ? "fulfilment" : "delivered_checked");
  const emitted: FulfilmentStatus[] = [];
  for (let idx = fromIdx; idx < targetIdx; idx += 1) {
    const next = STATUS_FLOW[idx + 1];
    await executor
      .insertInto("order_status_events")
      .values({
        order_id: input.orderId,
        status: next,
        note: `${input.notePrefix ?? ""}${
          next === "fulfilment"
            ? (input.fulfilmentNote ?? BOOKING_NOTE)
            : ARRIVAL_NOTE
        }`,
        created_by: input.createdBy,
      })
      .execute();
    emitted.push(next);
  }
  return done(emitted);
}
