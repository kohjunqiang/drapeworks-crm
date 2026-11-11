// scripts/seed-mark-won-fixture.ts
//
// Synthetic fixture for QA of the manual Mark as Won flow on the disposable
// cluster. Covers the confirmed shapes:
//   A  lead with no customer_id + an advanced (locked, po_ready) unlinked order
//   B  lead linked to a pre-deposit order; same customer has a later locked
//      unlinked order -> explicit replace-old-link path
//   C  lead with no customer_id + an unlinked deposit_received order
//   D  lead with customer_id + an unlinked fulfilment order
// plus an unlinked pre-deposit order and a draft order for the rejection
// guidance. Insert-only with dedicated UUIDs; nothing deleted, no trigger
// disabled, no external calls.
//
//   node --import tsx scripts/seed-mark-won-fixture.ts \
//     postgresql://jason@127.0.0.1:55439/drapeworks_priority_local

import { Kysely, PostgresDialect, sql, type Transaction } from "kysely";
import { Pool } from "pg";

import type { DB } from "../src/lib/db/schema";
import { STATUS_FLOW } from "../src/lib/status-flow";
import type { FulfilmentStatus } from "../src/lib/db/schema";

// Dedicated fixture namespace — disjoint from 11111111-… and 22222222-…
const ACTOR = "33333333-3333-4333-8333-3333333333aa";

const CUSTOMER_A = "33333333-3333-4333-8333-3333333300a1";
const CUSTOMER_B = "33333333-3333-4333-8333-3333333300b1";
const CUSTOMER_C = "33333333-3333-4333-8333-3333333300c1";
const CUSTOMER_D = "33333333-3333-4333-8333-3333333300d1";

const LEAD_A = "33333333-3333-4333-8333-3333333310a1";
const LEAD_B = "33333333-3333-4333-8333-3333333310b1";
const LEAD_C = "33333333-3333-4333-8333-3333333310c1";
const LEAD_D = "33333333-3333-4333-8333-3333333310d1";

const ORDER_A_ADVANCED = "33333333-3333-4333-8333-3333333320a1"; // po_ready
const ORDER_B_OLD = "33333333-3333-4333-8333-3333333320b1";      // order_recorded, linked
const ORDER_B_NEW = "33333333-3333-4333-8333-3333333320b2";      // delivered_checked
const ORDER_C_DEPOSIT = "33333333-3333-4333-8333-3333333320c1";  // deposit_received
const ORDER_C_PREDEPOSIT = "33333333-3333-4333-8333-3333333320c2"; // order_recorded
const ORDER_D_FULFIL = "33333333-3333-4333-8333-3333333320d1";   // fulfilment
const ORDER_DRAFT = "33333333-3333-4333-8333-3333333320e1";      // draft

function guardedUrl(): string {
  const raw = process.argv[2] ?? process.env.DATABASE_URL ?? "";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Pass the local cluster URL as argv[2] or DATABASE_URL");
  }
  const ok =
    (url.protocol === "postgresql:" || url.protocol === "postgres:") &&
    url.hostname === "127.0.0.1" &&
    url.port === "55439" &&
    url.pathname === "/drapeworks_priority_local";
  if (!ok) {
    throw new Error(
      "Refusing to run: target must be 127.0.0.1:55439/drapeworks_priority_local.",
    );
  }
  return raw;
}

async function exists(db: Kysely<DB>, table: string, id: string) {
  const row = await sql<{ id: string }>`
    select id from ${sql.table(table)} where id = ${id}
  `.execute(db);
  return row.rows.length > 0;
}

async function seedOrder(
  trx: Transaction<DB>,
  id: string,
  customerId: string,
  toStatus: FulfilmentStatus,
  leadId: string | null,
) {
  await trx.insertInto("orders").values({
    id,
    customer_id: customerId,
    consultant_id: ACTOR,
    development: "WON FIXTURE",
    product_line: "curtain",
    lead_id: leadId,
    // Placeholders — orders_assign_display_id overwrites them.
    display_id: "",
    seq_num: 0,
    seq_year: 0,
    is_draft: false,
  }).execute();
  // Walk the real status flow so current_status is set by the same
  // constrained path as production, not written directly.
  for (const status of STATUS_FLOW.slice(1, STATUS_FLOW.indexOf(toStatus) + 1)) {
    await trx.insertInto("order_status_events").values({
      order_id: id,
      status,
      note: "[FIXTURE] seeded status",
      created_by: ACTOR,
    }).execute();
  }
}

async function main() {
  const db = new Kysely<DB>({
    dialect: new PostgresDialect({
      pool: new Pool({ connectionString: guardedUrl(), max: 1, ssl: false }),
    }),
  });
  try {
    await sql`insert into auth.users (id, email) values (${ACTOR}, 'won-fixture@example.test') on conflict (id) do nothing`.execute(db);
    await sql`insert into profiles (id, email, full_name) values (${ACTOR}, 'won-fixture@example.test', 'Won Fixture Actor') on conflict (id) do nothing`.execute(db);

    for (const [id, name, mobile] of [
      [CUSTOMER_A, "WON FIXTURE ANG", "91000001"],
      [CUSTOMER_B, "WON FIXTURE BOH", "91000002"],
      [CUSTOMER_C, "WON FIXTURE CHAN", "91000003"],
      [CUSTOMER_D, "WON FIXTURE DAS", "91000004"],
    ] as const) {
      if (!(await exists(db, "customers", id))) {
        await db.insertInto("customers")
          .values({ id, name, mobile }).execute();
      }
    }

    for (const [id, name, ref, customerId] of [
      [LEAD_A, "WON FIXTURE LEAD A", "MW-FIX-A", null],
      [LEAD_B, "WON FIXTURE LEAD B", "MW-FIX-B", CUSTOMER_B],
      [LEAD_C, "WON FIXTURE LEAD C", "MW-FIX-C", null],
      [LEAD_D, "WON FIXTURE LEAD D", "MW-FIX-D", CUSTOMER_D],
    ] as const) {
      if (!(await exists(db, "leads", id))) {
        await db.insertInto("leads").values({
          id,
          lead_ref: ref,
          name,
          contact_channel: "Other",
          // Required by the schema; the before-insert trigger derives the
          // authoritative value from the funnel fields.
          lead_status: "Active",
          funnel_stage: "Decision Pending",
          customer_id: customerId,
          owner_id: ACTOR,
          assigned_consultant_id: ACTOR,
        }).execute();
        console.log(`SEEDED lead ${name} ${id}`);
      } else {
        console.log(`SKIP lead ${name} ${id} — already exists`);
      }
    }

    const orders: [string, string, FulfilmentStatus, string | null][] = [
      [ORDER_A_ADVANCED, CUSTOMER_A, "po_ready", null],
      [ORDER_B_OLD, CUSTOMER_B, "order_recorded", LEAD_B],
      [ORDER_B_NEW, CUSTOMER_B, "delivered_checked", null],
      [ORDER_C_DEPOSIT, CUSTOMER_C, "deposit_received", null],
      [ORDER_C_PREDEPOSIT, CUSTOMER_C, "order_recorded", null],
      [ORDER_D_FULFIL, CUSTOMER_D, "fulfilment", null],
    ];
    for (const [id, customerId, status, leadId] of orders) {
      if (await exists(db, "orders", id)) {
        console.log(`SKIP order ${id} — already exists`);
        continue;
      }
      await db.transaction().execute(async (trx) => {
        await seedOrder(trx, id, customerId, status, leadId);
      });
      console.log(`SEEDED order ${id} at ${status}`);
    }

    if (await exists(db, "orders", ORDER_DRAFT)) {
      console.log(`SKIP draft order ${ORDER_DRAFT} — already exists`);
    } else {
      await db.insertInto("orders").values({
        id: ORDER_DRAFT,
        customer_id: CUSTOMER_A,
        consultant_id: ACTOR,
        development: "WON FIXTURE",
        product_line: "curtain",
        display_id: "",
        seq_num: 0,
        seq_year: 0,
        is_draft: true,
      }).execute();
      console.log(`SEEDED draft order ${ORDER_DRAFT}`);
    }

    console.log("mark-won fixture ready:");
    console.log(`  lead A (null customer)        /leads/${LEAD_A} -> link ${ORDER_A_ADVANCED} (po_ready)`);
    console.log(`  lead B (pre-deposit linked)   /leads/${LEAD_B} -> replace with ${ORDER_B_NEW} (delivered_checked)`);
    console.log(`  lead C (null customer)        /leads/${LEAD_C} -> link ${ORDER_C_DEPOSIT} (deposit_received)`);
    console.log(`  lead D (customer set)         /leads/${LEAD_D} -> link ${ORDER_D_FULFIL} (fulfilment)`);
    console.log(`  ineligible examples           ${ORDER_C_PREDEPOSIT} (order_recorded), ${ORDER_DRAFT} (draft)`);
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
