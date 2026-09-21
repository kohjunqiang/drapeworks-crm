/**
 * Local-only integration check for the arrival → status reconciliation.
 *
 * Seeds clearly-labelled synthetic orders inside ONE transaction against the
 * isolated local database (127.0.0.1:55439/drapeworks_priority_local), runs the
 * real reconcileFulfilmentStatus helper through the real
 * ose_validate_transition / order_status_events_sync triggers, asserts the
 * resulting status and event audit trail, then rolls the transaction back.
 * A second phase then checks two-connection lock serialization against a
 * committed labelled fixture that is deleted again on the way out. No
 * production or customer data is touched.
 *
 * Usage:
 *   DATABASE_URL=postgresql://127.0.0.1:55439/drapeworks_priority_local \
 *     node --import tsx scripts/verify-arrival-reconcile.ts
 */
import { Kysely, PostgresDialect, sql, type Transaction } from "kysely";
import { Pool } from "pg";

import type {
  DB,
  FulfilmentStatus,
  OrderShipments,
} from "../src/lib/db/schema";
import { reconcileFulfilmentStatus } from "../src/lib/logistics/reconcile";
import { STATUS_FLOW, STATUS_LABELS } from "../src/lib/status-flow";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("Pass the isolated local DATABASE_URL explicitly");
}
const url = new URL(connectionString);
if (
  url.hostname !== "127.0.0.1" ||
  url.port !== "55439" ||
  url.pathname !== "/drapeworks_priority_local"
) {
  throw new Error("Refusing non-test destination");
}

const db = new Kysely<DB>({
  dialect: new PostgresDialect({
    pool: new Pool({ connectionString, ssl: false, max: 1 }),
  }),
});

// A dedicated synthetic actor provisioned by this script — it never relies on
// or modifies any pre-existing local profile.
const ACTOR = "00000000-0000-4000-8000-000000000098";
const ROLLBACK = new Error("__verify_rollback__");

type Executor = Kysely<DB> | Transaction<DB>;

/** auth.users has a trigger that creates profiles; insert both defensively. */
async function provisionActor(executor: Executor) {
  await sql`insert into auth.users (id, email) values (${ACTOR}, 'reconcile-verify@example.test') on conflict (id) do nothing`.execute(executor);
  await sql`insert into profiles (id, email, full_name) values (${ACTOR}, 'reconcile-verify@example.test', 'Reconcile Verify Actor') on conflict (id) do nothing`.execute(executor);
}

type ShipmentSeed = {
  category: OrderShipments["category"];
  notNeeded?: boolean;
  freight?: string | null;
  arrived?: boolean;
};

async function seedOrder(
  trx: Executor,
  opts: {
    status: FulfilmentStatus;
    shipments: ShipmentSeed[];
    booking?: "active" | "cancelled";
  },
): Promise<{ orderId: string; customerId: string }> {
  const customer = await trx
    .insertInto("customers")
    .values({ name: "RECONCILE VERIFY CUSTOMER", mobile: "00000000" })
    .returning("id")
    .executeTakeFirstOrThrow();
  const order = await trx
    .insertInto("orders")
    // seq/display columns are placeholders — orders_assign_display_id
    // overwrites them on every insert.
    .values({ customer_id: customer.id, display_id: "", seq_num: 0, seq_year: 0, is_draft: false })
    .returning("id")
    .executeTakeFirstOrThrow();

  const targetIdx = STATUS_FLOW.indexOf(opts.status);
  for (let i = 1; i <= targetIdx; i += 1) {
    await trx
      .insertInto("order_status_events")
      .values({
        order_id: order.id,
        status: STATUS_FLOW[i],
        note: "[VERIFY] seeded status",
        created_by: ACTOR,
      })
      .execute();
  }

  for (const shipment of opts.shipments) {
    await trx
      .insertInto("order_shipments")
      .values({
        order_id: order.id,
        category: shipment.category,
        not_needed: shipment.notNeeded ?? false,
        overseas_freight_number: shipment.freight ?? null,
        overseas_freight_assigned_at: shipment.freight ? new Date() : null,
        arrived_checked_at: shipment.arrived ? new Date() : null,
        arrived_checked_by: shipment.arrived ? ACTOR : null,
      })
      .execute();
  }

  if (opts.booking) {
    await trx
      .insertInto("fulfilment_arrangements")
      .values({
        order_id: order.id,
        scheduled_at: new Date("2026-09-25T02:00:00Z"),
        address: "1 Verify Way",
        created_by: ACTOR,
        ...(opts.booking === "cancelled"
          ? {
              cancelled_at: new Date(),
              cancelled_by: ACTOR,
              cancellation_reason: "verify",
            }
          : {}),
      })
      .execute();
  }
  return { orderId: order.id, customerId: customer.id };
}

async function currentStatus(
  trx: Executor,
  orderId: string,
): Promise<FulfilmentStatus> {
  const row = await trx
    .selectFrom("orders")
    .select("current_status")
    .where("id", "=", orderId)
    .executeTakeFirstOrThrow();
  return row.current_status;
}

function expectEqual<T>(actual: T, expected: T, label: string) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

async function expectCase(
  trx: Executor,
  label: string,
  opts: Parameters<typeof seedOrder>[1],
  expectedTo: FulfilmentStatus,
  expectedEmitted: number,
) {
  const { orderId } = await seedOrder(trx, opts);
  const result = await reconcileFulfilmentStatus(trx, {
    orderId,
    createdBy: ACTOR,
    notePrefix: "[VERIFY] ",
  });
  expectEqual(result.to, expectedTo, label);
  expectEqual(result.emitted.length, expectedEmitted, `${label} emitted`);
  expectEqual(await currentStatus(trx, orderId), expectedTo, `${label} stored`);
  // Every emitted row carries the reconcile note; event timestamps share the
  // transaction clock, so count by note rather than by position.
  const reconciled = await trx
    .selectFrom("order_status_events")
    .select(["status", "note", "created_by"])
    .where("order_id", "=", orderId)
    .where("note", "like", "[VERIFY] Auto-reconciled:%")
    .execute();
  expectEqual(reconciled.length, expectedEmitted, `${label} audit rows`);
  for (const event of reconciled) {
    expectEqual(event.created_by, ACTOR, `${label} created_by`);
  }
  // Idempotent: a second run emits nothing.
  const again = await reconcileFulfilmentStatus(trx, {
    orderId,
    createdBy: ACTOR,
    notePrefix: "[VERIFY] ",
  });
  expectEqual(again.emitted.length, 0, `${label} idempotent`);
  console.log(`PASS ${label}: ${STATUS_LABELS[result.from]} -> ${STATUS_LABELS[result.to]} (${result.emitted.length} events)`);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A second connection cannot see the rolled-back transaction above, so the
 * lock/serialization check uses its own committed fixture and removes it
 * afterwards. Every row is labelled synthetic and confined to the local DB.
 */
async function concurrencyCheck() {
  const db2 = new Kysely<DB>({
    dialect: new PostgresDialect({
      pool: new Pool({ connectionString, ssl: false, max: 2 }),
    }),
  });
  let orderId: string | undefined;
  let customerId: string | undefined;
  try {
    await provisionActor(db2);
    ({ orderId, customerId } = await seedOrder(db2, {
      status: "sent_to_vendor",
      shipments: [{ category: "curtains", freight: "FR-CONC", arrived: true }],
    }));

    // Connection A holds the order row lock while connection B reconciles: B
    // must wait for the lock instead of interleaving status events.
    let aHoldsLock = false;
    let bFinished = false;
    const LOCK_TX = new Error("__lock_tx_done__");
    const txA = db2
      .transaction()
      .execute(async (trxA) => {
        await trxA
          .selectFrom("orders")
          .select("id")
          .where("id", "=", orderId!)
          .forUpdate()
          .executeTakeFirstOrThrow();
        aHoldsLock = true;
        await sleep(1200);
        throw LOCK_TX;
      })
      .catch((error) => {
        if (error !== LOCK_TX) throw error;
      });
    let bEmitted = -1;
    const txB = (async () => {
      for (let i = 0; i < 200 && !aHoldsLock; i += 1) await sleep(25);
      try {
        await db2.transaction().execute(async (trxB) => {
          const result = await reconcileFulfilmentStatus(trxB, {
            orderId: orderId!,
            createdBy: ACTOR,
            notePrefix: "[VERIFY] ",
          });
          bEmitted = result.emitted.length;
          throw ROLLBACK;
        });
      } catch (error) {
        if (error !== ROLLBACK) throw error;
      }
      bFinished = true;
    })();

    await sleep(600);
    expectEqual(bFinished, false, "concurrent reconcile must wait on the row lock");
    await txA; // releases the lock by rolling back
    await txB;
    // A wrote nothing, so B performs the full catch-up itself after waiting.
    expectEqual(bEmitted, 3, "post-lock reconcile emitted");

    // A committed reconciliation is visible to a later connection, which must
    // emit no duplicate events.
    const committed = await db2.transaction().execute((trx) =>
      reconcileFulfilmentStatus(trx, {
        orderId: orderId!,
        createdBy: ACTOR,
        notePrefix: "[VERIFY] ",
      }),
    );
    expectEqual(committed.emitted.length, 3, "committed reconcile");
    expectEqual(await currentStatus(db2, orderId), "delivered_checked", "committed status");
    const repeat = await db2.transaction().execute((trx) =>
      reconcileFulfilmentStatus(trx, {
        orderId: orderId!,
        createdBy: ACTOR,
        notePrefix: "[VERIFY] ",
      }),
    );
    expectEqual(repeat.emitted.length, 0, "repeat reconcile on second connection");
    console.log("PASS concurrency: row lock serializes reconcilers; repeat emits no duplicates");
  } finally {
    try {
      await db2.transaction().execute(async (trx) => {
        await sql`set local app.allow_locked_order_delete = 'on'`.execute(trx);
        if (orderId) {
          await trx.deleteFrom("order_status_events").where("order_id", "=", orderId).execute();
          await trx.deleteFrom("order_shipments").where("order_id", "=", orderId).execute();
          await trx.deleteFrom("fulfilment_arrangements").where("order_id", "=", orderId).execute();
          await trx.deleteFrom("orders").where("id", "=", orderId).execute();
        }
        if (customerId) {
          await trx.deleteFrom("customers").where("id", "=", customerId).execute();
        }
        await sql`delete from profiles where id = ${ACTOR}`.execute(trx);
        await sql`delete from auth.users where id = ${ACTOR}`.execute(trx);
      });
    } catch (error) {
      console.warn(
        `cleanup warning: labelled synthetic concurrency rows may remain (${error instanceof Error ? error.message : error})`,
      );
    }
    await db2.destroy();
  }
}

async function main() {
  try {
    await db.transaction().execute(async (trx) => {
      // Self-contained actor: the status-event/arrival audit columns reference
      // profiles, so provision one inside the transaction (rolled back below).
      await provisionActor(trx);
      await expectCase(
        trx,
        "last arrival at sent_to_vendor, no booking",
        {
          status: "sent_to_vendor",
          shipments: [
            { category: "curtains", freight: "FR-C", arrived: true },
            { category: "standard_tracks", freight: "FR-T", arrived: true },
          ],
        },
        "delivered_checked",
        3,
      );
      await expectCase(
        trx,
        "last arrival at sent_logistic, no booking",
        { status: "sent_logistic", shipments: [{ category: "curtains", freight: "FR-C", arrived: true }] },
        "delivered_checked",
        2,
      );
      await expectCase(
        trx,
        "last arrival at shipping_sg, no booking",
        { status: "shipping_sg", shipments: [{ category: "curtains", freight: "FR-C", arrived: true }] },
        "delivered_checked",
        1,
      );
      await expectCase(
        trx,
        "all arrived + active booking (booked before arrival)",
        {
          status: "sent_to_vendor",
          shipments: [{ category: "curtains", freight: "FR-C", arrived: true }],
          booking: "active",
        },
        "fulfilment",
        4,
      );
      await expectCase(
        trx,
        "unshipped component keeps the order at sent_to_vendor",
        {
          status: "sent_to_vendor",
          shipments: [
            { category: "curtains", freight: "FR-C", arrived: true },
            { category: "standard_tracks", arrived: false },
          ],
        },
        "sent_to_vendor",
        0,
      );
      await expectCase(
        trx,
        "all shipped, none arrived reaches shipping_sg",
        {
          status: "sent_to_vendor",
          shipments: [
            { category: "curtains", freight: "FR-C" },
            { category: "standard_tracks", notNeeded: true },
          ],
        },
        "shipping_sg",
        2,
      );
      await expectCase(
        trx,
        "cancelled booking is not active",
        {
          status: "sent_to_vendor",
          shipments: [{ category: "curtains", freight: "FR-C", arrived: true }],
          booking: "cancelled",
        },
        "delivered_checked",
        3,
      );
      await expectCase(
        trx,
        "not-needed rows are ignored",
        {
          status: "sent_logistic",
          shipments: [
            { category: "curtains", freight: "FR-C", arrived: true },
            { category: "standard_tracks", notNeeded: true },
          ],
        },
        "delivered_checked",
        2,
      );
      await expectCase(
        trx,
        "all rows not-needed is conservative",
        {
          status: "sent_to_vendor",
          shipments: [{ category: "curtains", notNeeded: true, freight: "FR-C", arrived: true }],
        },
        "sent_to_vendor",
        0,
      );
      await expectCase(
        trx,
        "empty manifest never advances",
        { status: "sent_to_vendor", shipments: [] },
        "sent_to_vendor",
        0,
      );
      await expectCase(
        trx,
        "placeholder freight is not an arrival",
        {
          status: "shipping_sg",
          shipments: [{ category: "curtains", freight: "N/A", arrived: true }],
        },
        "shipping_sg",
        0,
      );
      await expectCase(
        trx,
        "completed order never regresses",
        {
          status: "completed",
          shipments: [{ category: "curtains", freight: "FR-C", arrived: true }],
          booking: "active",
        },
        "completed",
        0,
      );
      await expectCase(
        trx,
        "delivered_checked + booking reaches fulfilment only",
        {
          status: "delivered_checked",
          shipments: [{ category: "curtains", freight: "FR-C", arrived: true }],
          booking: "active",
        },
        "fulfilment",
        1,
      );
      // Force deferred constraints to be checked now, while the rollback
      // still discards them.
      await sql`set constraints all immediate`.execute(trx);
      throw ROLLBACK;
    });
  } catch (error) {
    if (error !== ROLLBACK) throw error;
  }
  console.log("All reconcile cases passed inside a rolled-back transaction — no data was written.");
  await concurrencyCheck();
}

main().finally(() => db.destroy());
