import type { Kysely } from "kysely";
import { sql } from "kysely";

import type { DB, FulfilmentStatus } from "@/lib/db/schema";
import { diffSgDays, toSgDate, type SgDate } from "@/lib/leads/sg-date";
import { statusIndex } from "@/lib/status-flow";

export type OrderDayCounter = {
  kind: "payment" | "po";
  days: number;
};

/**
 * Earliest event at a status — a repeated same-status note or admin amendment
 * writes another event, and the clock means "when it happened", not "when it
 * was last touched". Same rule as the detail page's lockedAt.
 */
export function earliestStatusEventAt(
  events: { status: string; created_at: Date | string }[],
  status: FulfilmentStatus,
): Date | null {
  return events
    .filter((event) => event.status === status)
    .reduce<Date | null>((earliest, event) => {
      const at = new Date(event.created_at);
      return earliest && earliest <= at ? earliest : at;
    }, null);
}

/**
 * One bounded lookup of first deposit / first send-to-vendor per order, for
 * list pages. Missing milestones stay absent — there is no created_at /
 * updated_at fallback, so an order with no event row simply shows no clock.
 */
export async function loadOrderMilestoneDates(
  db: Kysely<DB>,
  orderIds: string[],
): Promise<
  Map<string, { depositReceivedAt: Date | null; sentToVendorAt: Date | null }>
> {
  const map = new Map<
    string,
    { depositReceivedAt: Date | null; sentToVendorAt: Date | null }
  >();
  if (!orderIds.length) return map;
  const rows = await db
    .selectFrom("order_status_events")
    .select([
      "order_id",
      "status",
      sql<Date>`min(created_at)`.as("first_at"),
    ])
    .where("order_id", "in", orderIds)
    .where("status", "in", ["deposit_received", "sent_to_vendor"])
    .groupBy(["order_id", "status"])
    .execute();
  for (const row of rows) {
    const entry = map.get(row.order_id) ?? {
      depositReceivedAt: null,
      sentToVendorAt: null,
    };
    if (row.status === "deposit_received") {
      entry.depositReceivedAt = row.first_at;
    } else if (row.status === "sent_to_vendor") {
      entry.sentToVendorAt = row.first_at;
    }
    map.set(row.order_id, entry);
  }
  return map;
}

/**
 * Which clock an order shows, derived from its CURRENT status — an admin
 * revert below a milestone hides the obsolete clock even though the old
 * events still exist.
 *
 * - At/after sent_to_vendor (incl. completed): days since the PO went out.
 * - From deposit_received to po_ready: days since payment. A generated PO
 *   (po_ready) is not a sent PO, so the payment clock keeps running.
 * - Before deposit_received, or with no matching event: no clock.
 */
export function orderDayCounter(args: {
  currentStatus: FulfilmentStatus;
  depositReceivedAt: Date | string | null;
  sentToVendorAt: Date | string | null;
  today: SgDate;
}): OrderDayCounter | null {
  const idx = statusIndex(args.currentStatus);
  if (idx >= statusIndex("sent_to_vendor")) {
    if (!args.sentToVendorAt) return null;
    return {
      kind: "po",
      days: Math.max(
        0,
        diffSgDays(toSgDate(new Date(args.sentToVendorAt)), args.today),
      ),
    };
  }
  if (idx >= statusIndex("deposit_received")) {
    if (!args.depositReceivedAt) return null;
    return {
      kind: "payment",
      days: Math.max(
        0,
        diffSgDays(toSgDate(new Date(args.depositReceivedAt)), args.today),
      ),
    };
  }
  return null;
}

export function orderDayCounterLabel(
  counter: OrderDayCounter | null,
): string | null {
  if (!counter) return null;
  return `${counter.days} ${counter.days === 1 ? "day" : "days"} since ${
    counter.kind === "po" ? "PO sent" : "payment"
  }`;
}
