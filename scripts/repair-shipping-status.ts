/**
 * One-off audited operator repair for orders 10053
 * (706b14c1-82dd-43cc-b7da-e14db84fbb2b) and 10052
 * (f26df91d-2e51-446d-8c76-c997a78e313a), whose required shipment components
 * already carry overseas freight numbers while the status stayed behind at
 * Sent to Vendor — the dashboard freight manager assigned the codes without
 * advancing the status.
 *
 * DRY RUN is the default: the reconciliation events are inserted inside the
 * transaction, the resulting evidence is printed, deferred constraints are
 * forced immediate, and everything is rolled back — which also proves the
 * ose_validate_transition trigger accepts the catch-up walk. Pass --execute
 * to actually commit.
 *
 * Scope is hard-locked: the script repairs only those two UUIDs, refuses any
 * other --order-id, and re-verifies each order's reference (10053 / 10052)
 * under the row lock before mutating. The run is idempotent: an order already
 * at (or past) its reconciled status emits no events.
 *
 * Generated events carry created_by = NULL — they are an automated
 * reconciliation authorized by the operator, not the work of any prior human
 * actor — and a note that says so. Historical event authors and original
 * shipment timestamps are untouched.
 *
 * Only order identifiers, statuses and timestamps are printed — no customer
 * PII and no pre-existing note contents. Nothing outside the two orders is
 * read or written.
 *
 * Usage:
 *   DATABASE_URL=... node --import tsx scripts/repair-shipping-status.ts                            # dry run, both orders
 *   DATABASE_URL=... node --import tsx scripts/repair-shipping-status.ts --order-id <uuid>          # dry run, one order
 *   DATABASE_URL=... node --import tsx scripts/repair-shipping-status.ts --execute                  # commit
 *   DATABASE_URL=... node --import tsx scripts/repair-shipping-status.ts --order-id <uuid> --execute
 */
import "dotenv/config";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";

import type { DB } from "../src/lib/db/schema";
import { reconcileFulfilmentStatus } from "../src/lib/logistics/reconcile";
import { STATUS_LABELS } from "../src/lib/status-flow";

const AUTHORIZED_ORDERS: Readonly<Record<string, string>> = {
  "706b14c1-82dd-43cc-b7da-e14db84fbb2b": "10053",
  "f26df91d-2e51-446d-8c76-c997a78e313a": "10052",
};
const NOTE_PREFIX = "[REPAIR] ";

const args = process.argv.slice(2);
const flagIndex = args.indexOf("--order-id");
const requested = flagIndex >= 0 ? args[flagIndex + 1] : undefined;
const execute = args.includes("--execute");
if (flagIndex >= 0 && !(requested && requested in AUTHORIZED_ORDERS)) {
  throw new Error(
    `This repair is scoped to orders ${Object.keys(AUTHORIZED_ORDERS).join(", ")} only; refusing '${requested ?? "(none)"}'`,
  );
}
const orderIds = requested ? [requested] : Object.keys(AUTHORIZED_ORDERS);

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
      for (const orderId of orderIds) {
        const expectedReference = AUTHORIZED_ORDERS[orderId];
        const order = await trx
          .selectFrom("orders")
          .select(["id", "order_reference", "current_status", "is_draft"])
          .where("id", "=", orderId)
          .forUpdate()
          .executeTakeFirst();
        if (!order) throw new Error(`Order ${orderId} not found`);
        // Re-verify the intended predicate under the lock before any mutation:
        // the customer-facing references are 10053 and 10052.
        if (order.order_reference !== expectedReference) {
          throw new Error(
            `Refusing to repair ${orderId}: expected reference ${expectedReference}, found ${order.order_reference ?? "(none)"}`,
          );
        }
        if (order.is_draft) throw new Error("Refusing to repair a draft order");
        console.log(
          `Order ${order.id} / ${order.order_reference}: ${STATUS_LABELS[order.current_status]}`,
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
        console.log("  Shipments:");
        for (const shipment of shipments) {
          console.log(
            `    ${shipment.category}: not_needed=${shipment.not_needed} ` +
              `freight=${shipment.overseas_freight_number?.trim() ? "set" : "missing"} ` +
              `arrived=${shipment.arrived_checked_at?.toISOString() ?? "no"}`,
          );
        }

        const result = await reconcileFulfilmentStatus(trx, {
          orderId,
          createdBy: null,
          notePrefix: NOTE_PREFIX,
        });

        if (result.emitted.length === 0) {
          console.log("  No reconciliation needed — already consistent.");
        } else {
          // Only the events generated by this run are printed; pre-existing
          // note contents are customer-visible text and stay unread.
          const generated = await trx
            .selectFrom("order_status_events")
            .select(["status", "created_at"])
            .where("order_id", "=", orderId)
            .where("note", "like", `${NOTE_PREFIX}%`)
            .orderBy("created_at")
            .orderBy("id")
            .execute();
          for (const event of generated) {
            console.log(`    ${event.created_at.toISOString()} ${event.status}`);
          }
          console.log(
            `  ${execute ? "Will commit" : "Would commit"}: ${STATUS_LABELS[result.from]} -> ${STATUS_LABELS[result.to]} via [${result.emitted.join(", ")}]`,
          );
        }
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
