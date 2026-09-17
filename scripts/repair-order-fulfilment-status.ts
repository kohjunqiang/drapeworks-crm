/**
 * One-off audited operator repair for order 10051
 * (22e8f73b-a140-4343-980f-eb7fc160ee28), whose shipment manifest already
 * arrived and whose installation is already booked while the status stayed
 * behind at Sent to Vendor.
 *
 * DRY RUN is the default: the reconciliation events are inserted inside the
 * transaction, the resulting evidence is printed, deferred constraints are
 * forced immediate, and everything is rolled back — which also proves the
 * ose_validate_transition trigger accepts the catch-up walk. Pass --execute
 * to actually commit.
 *
 * Scope is hard-locked: the script repairs only that one UUID, refuses any
 * other --order-id, and re-verifies the order's reference (10051) and display
 * id (DW-2026-0016) under the row lock before mutating. The run is
 * idempotent: an order already at (or past) its reconciled status emits no
 * events.
 *
 * Generated events carry created_by = NULL — they are an automated
 * reconciliation authorized by the operator, not the work of any prior human
 * actor — and a note that says so. Historical event authors and original
 * shipment/booking timestamps are untouched.
 *
 * Only order identifiers, statuses and timestamps are printed — no customer
 * PII and no pre-existing note contents. Nothing outside the single order is
 * read or written.
 *
 * Usage:
 *   DATABASE_URL=... node --import tsx scripts/repair-order-fulfilment-status.ts            # dry run
 *   DATABASE_URL=... node --import tsx scripts/repair-order-fulfilment-status.ts --execute  # commit
 */
import "dotenv/config";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";

import type { DB } from "../src/lib/db/schema";
import { reconcileFulfilmentStatus } from "../src/lib/logistics/reconcile";
import { STATUS_LABELS } from "../src/lib/status-flow";

const AUTHORIZED_ORDER_ID = "22e8f73b-a140-4343-980f-eb7fc160ee28";
const AUTHORIZED_ORDER_REFERENCE = "10051";
const AUTHORIZED_DISPLAY_ID = "DW-2026-0016";
const NOTE_PREFIX = "[REPAIR] Automated reconciliation authorized by operator: ";

const args = process.argv.slice(2);
const flagIndex = args.indexOf("--order-id");
const requested = flagIndex >= 0 ? args[flagIndex + 1] : AUTHORIZED_ORDER_ID;
const execute = args.includes("--execute");
if (requested !== AUTHORIZED_ORDER_ID) {
  throw new Error(
    `This repair is scoped to order ${AUTHORIZED_ORDER_ID} only; refusing '${requested ?? "(none)"}'`,
  );
}
const orderId = AUTHORIZED_ORDER_ID;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const target = new URL(connectionString);
console.log(
  `Target: ${target.hostname}${target.pathname} — ${execute ? "EXECUTE (commits)" : "DRY RUN (rolls back)"}`,
);

const DRY_RUN = new Error("__dry_run_rollback__");

const db = new Kysely<DB>({
  dialect: new PostgresDialect({
    pool: new Pool({
      connectionString,
      max: 1,
      ssl: { rejectUnauthorized: false },
    }),
  }),
});

async function main() {
  try {
    await db.transaction().execute(async (trx) => {
      const order = await trx
        .selectFrom("orders")
        .select(["id", "display_id", "order_reference", "current_status", "is_draft"])
        .where("id", "=", orderId)
        .forUpdate()
        .executeTakeFirst();
      if (!order) throw new Error("Order not found");
      // Re-verify the intended predicate under the lock before any mutation:
      // the customer-facing reference is 10051, display id DW-2026-0016.
      if (
        order.order_reference !== AUTHORIZED_ORDER_REFERENCE ||
        order.display_id !== AUTHORIZED_DISPLAY_ID
      ) {
        throw new Error(
          `Refusing to repair: expected reference ${AUTHORIZED_ORDER_REFERENCE} / display id ${AUTHORIZED_DISPLAY_ID}, found ${order.order_reference ?? "(none)"} / ${order.display_id}`,
        );
      }
      if (order.is_draft) throw new Error("Refusing to repair a draft order");
      console.log(
        `Order ${order.display_id}${order.order_reference ? ` / ${order.order_reference}` : ""}: ${STATUS_LABELS[order.current_status]}`,
      );

      const shipments = await trx
        .selectFrom("order_shipments")
        .select([
          "category",
          "not_needed",
          "overseas_freight_number",
          "arrived_checked_at",
        ])
        .where("order_id", "=", orderId)
        .execute();
      console.log("Shipments:");
      for (const shipment of shipments) {
        console.log(
          `  ${shipment.category}: not_needed=${shipment.not_needed} ` +
            `freight=${shipment.overseas_freight_number?.trim() ? "set" : "missing"} ` +
            `arrived=${shipment.arrived_checked_at?.toISOString() ?? "no"}`,
        );
      }

      const booking = await trx
        .selectFrom("fulfilment_arrangements")
        .select(["scheduled_at", "cancelled_at"])
        .where("order_id", "=", orderId)
        .executeTakeFirst();
      console.log(
        booking
          ? `Booking: ${booking.scheduled_at.toISOString()} ${booking.cancelled_at ? "(cancelled)" : "(active)"}`
          : "Booking: none",
      );

      const result = await reconcileFulfilmentStatus(trx, {
        orderId,
        createdBy: null,
        notePrefix: NOTE_PREFIX,
      });

      const timeline = await trx
        .selectFrom("order_status_events")
        .select(["status", "note", "created_at"])
        .where("order_id", "=", orderId)
        .orderBy("created_at")
        .orderBy("id")
        .execute();
      console.log("Status timeline (in-transaction view):");
      for (const event of timeline) {
        // Only notes generated by this run are printed; pre-existing note
        // contents are customer-visible text and stay unread.
        const generated = event.note?.startsWith(NOTE_PREFIX);
        console.log(
          `  ${event.created_at.toISOString()} ${event.status}${generated ? ` — ${event.note}` : ""}`,
        );
      }

      if (result.emitted.length === 0) {
        console.log("No reconciliation needed — already consistent.");
      } else {
        console.log(
          `${execute ? "Will commit" : "Would commit"}: ${STATUS_LABELS[result.from]} -> ${STATUS_LABELS[result.to]} via [${result.emitted.join(", ")}]`,
        );
      }

      // Force deferred constraints to be checked before the dry-run rollback.
      await sql`set constraints all immediate`.execute(trx);
      if (!execute) throw DRY_RUN;
    });
    console.log("Committed.");
  } catch (error) {
    if (error !== DRY_RUN) throw error;
    console.log("Dry run rolled back — no changes were written.");
  }
}

main().finally(() => db.destroy());
