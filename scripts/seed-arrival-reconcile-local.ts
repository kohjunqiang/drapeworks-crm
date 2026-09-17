/**
 * Local-only fixture seeding for browser verification of the arrival → status
 * reconciliation. Creates three clearly-labelled synthetic orders in the
 * isolated test database (127.0.0.1:55439/drapeworks_priority_local). Refuses
 * any other destination. Idempotent: existing fixtures are left untouched, so
 * tester edits are preserved across reruns.
 *
 *   DATABASE_URL=postgresql://127.0.0.1:55439/drapeworks_priority_local \
 *     node --import tsx scripts/seed-arrival-reconcile-local.ts
 *
 * Then open the app (scripts/start-priority-local.mjs, port 3003) at the
 * printed /orders/<id> URLs. The dev auth bypass signs in as the existing
 * local admin profile; the fixtures' audit columns point at a dedicated
 * synthetic actor provisioned below so no existing profile is modified.
 */
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";

import type { DB, FulfilmentStatus, OrderShipments } from "../src/lib/db/schema";
import { STATUS_FLOW } from "../src/lib/status-flow";

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

// Dedicated fixture actor, provisioned idempotently below. It is NOT the
// signed-in dev profile (which stays the admin) and never gets
// is_presales_owner or role changes — it exists only to satisfy the audit
// column foreign keys on the fixture rows.
const ACTOR = "11111111-1111-4111-8111-1111111111aa";
const CUSTOMER_ID = "11111111-1111-4111-8111-111111111100";

const FIXTURES: {
  id: string;
  label: string;
  status: FulfilmentStatus;
  shipments: {
    category: OrderShipments["category"];
    freight: string;
    arrived: boolean;
  }[];
  booking?: boolean;
}[] = [
  {
    // Mark both arrivals in the UI -> Delivered & Checked (no booking).
    id: "11111111-1111-4111-8111-111111111101",
    label: "A — last arrivals, no booking",
    status: "sent_to_vendor",
    shipments: [
      { category: "curtains", freight: "RECON-A1", arrived: false },
      { category: "standard_tracks", freight: "RECON-A2", arrived: false },
    ],
  },
  {
    // Everything already arrived; book installation in the UI -> fulfilment.
    id: "11111111-1111-4111-8111-111111111102",
    label: "B — all arrived, book after",
    status: "sent_to_vendor",
    shipments: [
      { category: "curtains", freight: "RECON-B1", arrived: true },
      { category: "standard_tracks", freight: "RECON-B2", arrived: true },
    ],
  },
  {
    // Booking already active; mark the last arrival in the UI -> fulfilment.
    id: "11111111-1111-4111-8111-111111111103",
    label: "C — booked before last arrival",
    status: "sent_to_vendor",
    shipments: [
      { category: "curtains", freight: "RECON-C1", arrived: true },
      { category: "standard_tracks", freight: "RECON-C2", arrived: false },
    ],
    booking: true,
  },
];

async function main() {
  // auth.users has a trigger that creates profiles; insert both defensively so
  // the fixture actor exists regardless of trigger behaviour.
  await sql`insert into auth.users (id, email) values (${ACTOR}, 'reconcile-fixture@example.test') on conflict (id) do nothing`.execute(db);
  await sql`insert into profiles (id, email, full_name) values (${ACTOR}, 'reconcile-fixture@example.test', 'Reconcile Fixture Actor') on conflict (id) do nothing`.execute(db);

  await db
    .insertInto("customers")
    .values({ id: CUSTOMER_ID, name: "RECONCILE BROWSER TEST", mobile: "00000000" })
    .onConflict((conflict) => conflict.column("id").doNothing())
    .execute();

  for (const fixture of FIXTURES) {
    const existing = await db
      .selectFrom("orders")
      .select("id")
      .where("id", "=", fixture.id)
      .executeTakeFirst();
    if (existing) {
      console.log(`SKIP ${fixture.label} — fixture already exists`);
      continue;
    }

    await db.transaction().execute(async (trx) => {
      await trx
        .insertInto("orders")
        .values({
          id: fixture.id,
          customer_id: CUSTOMER_ID,
          consultant_id: ACTOR,
          development: "RECONCILE TEST",
          // Placeholders — orders_assign_display_id overwrites them.
          display_id: "",
          seq_num: 0,
          seq_year: 0,
          is_draft: false,
        })
        .execute();
      const targetIdx = STATUS_FLOW.indexOf(fixture.status);
      for (let i = 1; i <= targetIdx; i += 1) {
        await trx
          .insertInto("order_status_events")
          .values({
            order_id: fixture.id,
            status: STATUS_FLOW[i],
            note: "[FIXTURE] seeded status",
            created_by: ACTOR,
          })
          .execute();
      }
      for (const shipment of fixture.shipments) {
        await trx
          .insertInto("order_shipments")
          .values({
            order_id: fixture.id,
            category: shipment.category,
            overseas_freight_number: shipment.freight,
            overseas_freight_assigned_at: new Date(),
            arrived_checked_at: shipment.arrived ? new Date() : null,
            arrived_checked_by: shipment.arrived ? ACTOR : null,
          })
          .execute();
      }
      if (fixture.booking) {
        await trx
          .insertInto("fulfilment_arrangements")
          .values({
            order_id: fixture.id,
            scheduled_at: new Date(Date.now() + 3 * 24 * 3600 * 1000),
            address: "1 Fixture Way",
            created_by: ACTOR,
          })
          .execute();
      }
    });
    console.log(`SEEDED ${fixture.label}: /orders/${fixture.id}`);
  }
}

main().finally(() => db.destroy());
