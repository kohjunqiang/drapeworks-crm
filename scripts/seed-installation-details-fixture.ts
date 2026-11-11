// scripts/seed-installation-details-fixture.ts
//
// Synthetic fixture for QA of the installer-page edit feature on the
// disposable cluster: one curtain+blind order and one mesh order, each with
// a booking walked to `fulfilment` through real order_status_events and a
// fixed installer_token so the printed URLs are stable across reruns.
//
// Idempotent insert-only: every entity has a dedicated fixed UUID; existing
// rows are left untouched so tester edits survive reruns. Nothing is deleted
// or reseeded, and no trigger is ever disabled.
//
// Hard guard: only 127.0.0.1:55439/drapeworks_priority_local. Synthetic only
// — no real customer data. No external calls (no Google Calendar, no
// Supabase auth).
//
//   node --import tsx scripts/seed-installation-details-fixture.ts \
//     postgresql://jason@127.0.0.1:55439/drapeworks_priority_local

import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";

import type { DB } from "../src/lib/db/schema";
import { STATUS_FLOW } from "../src/lib/status-flow";

// Dedicated fixture namespace — disjoint from the arrival-reconcile fixtures
// (11111111-…) so both can coexist.
const ACTOR = "22222222-2222-4222-8222-2222222222aa";
const CUSTOMER = "22222222-2222-4222-8222-222222220001";

// Synthetic catalogue: a curtain series + Day/Night types and a blind series
// + type. Blinds are their own series (product_line 'blind') — never a
// curtain masquerade, and a blind type carries no Day/Night category.
const CURTAIN_SERIES = "22222222-2222-4222-8222-22222222c001";
const DAY_TYPE = "22222222-2222-4222-8222-22222222c002";
const NIGHT_TYPE = "22222222-2222-4222-8222-22222222c003";
const BLIND_SERIES = "22222222-2222-4222-8222-22222222b001";
const BLIND_TYPE = "22222222-2222-4222-8222-22222222b002";

const CURTAIN_ORDER = "22222222-2222-4222-8222-222222220a01";
const CURTAIN_ROOM = "22222222-2222-4222-8222-222222220a11";
const CURTAIN_WINDOW = "22222222-2222-4222-8222-222222220a21";
const BLIND_WINDOW = "22222222-2222-4222-8222-222222220a22";
const CURTAIN_BOOKING = "22222222-2222-4222-8222-222222220a31";
const CURTAIN_TOKEN = "22222222-2222-4222-8222-222222220a41";

const MESH_ORDER = "22222222-2222-4222-8222-222222220b01";
const MESH_ROOM = "22222222-2222-4222-8222-222222220b11";
const MESH_PANEL = "22222222-2222-4222-8222-222222220b21";
const MESH_BOOKING = "22222222-2222-4222-8222-222222220b31";
const MESH_TOKEN = "22222222-2222-4222-8222-222222220b41";

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

async function main() {
  const db = new Kysely<DB>({
    dialect: new PostgresDialect({
      pool: new Pool({ connectionString: guardedUrl(), max: 1, ssl: false }),
    }),
  });
  try {
    // auth.users has a trigger that creates profiles; insert both defensively
    // so the fixture actor exists regardless of trigger behaviour.
    await sql`insert into auth.users (id, email) values (${ACTOR}, 'install-fixture@example.test') on conflict (id) do nothing`.execute(db);
    await sql`insert into profiles (id, email, full_name) values (${ACTOR}, 'install-fixture@example.test', 'Install Fixture Actor') on conflict (id) do nothing`.execute(db);

    if (!(await exists(db, "customers", CUSTOMER))) {
      await db
        .insertInto("customers")
        .values({ id: CUSTOMER, name: "INSTALL FIXTURE TAN", mobile: "90000001" })
        .execute();
    }

    // --- Synthetic catalogue --------------------------------------------------
    if (!(await exists(db, "curtain_series", CURTAIN_SERIES))) {
      await db
        .insertInto("curtain_series")
        .values({
          id: CURTAIN_SERIES,
          name: "INSTALL FIXTURE LINEN",
          product_line: "curtain",
          sale_sgd_cents: 1200,
          created_by: ACTOR,
        })
        .execute();
    }
    if (!(await exists(db, "curtain_series", BLIND_SERIES))) {
      await db
        .insertInto("curtain_series")
        .values({
          id: BLIND_SERIES,
          name: "INSTALL FIXTURE ROLLER",
          product_line: "blind",
          sale_sgd_cents: 900,
          created_by: ACTOR,
        })
        .execute();
    }
    if (!(await exists(db, "curtain_types", DAY_TYPE))) {
      await db
        .insertInto("curtain_types")
        .values({
          id: DAY_TYPE,
          label: "FIXTURE DAY SHEER",
          category: "Day",
          series_id: CURTAIN_SERIES,
          series_index: 1,
          created_by: ACTOR,
        })
        .execute();
    }
    if (!(await exists(db, "curtain_types", NIGHT_TYPE))) {
      await db
        .insertInto("curtain_types")
        .values({
          id: NIGHT_TYPE,
          label: "FIXTURE NIGHT DIMOUT",
          category: "Night",
          series_id: CURTAIN_SERIES,
          series_index: 2,
          created_by: ACTOR,
        })
        .execute();
    }
    if (!(await exists(db, "curtain_types", BLIND_TYPE))) {
      await db
        .insertInto("curtain_types")
        .values({
          id: BLIND_TYPE,
          label: "FIXTURE ROLLER BLIND",
          category: null,
          series_id: BLIND_SERIES,
          series_index: 1,
          created_by: ACTOR,
        })
        .execute();
    }

    // --- Curtain + blind order --------------------------------------------------
    if (await exists(db, "orders", CURTAIN_ORDER)) {
      console.log(`SKIP curtain+blind order ${CURTAIN_ORDER} — already exists`);
    } else {
      await db.transaction().execute(async (trx) => {
        await trx
          .insertInto("orders")
          .values({
            id: CURTAIN_ORDER,
            customer_id: CUSTOMER,
            consultant_id: ACTOR,
            development: "INSTALL FIXTURE",
            product_line: "curtain",
            // Placeholders — orders_assign_display_id overwrites them.
            display_id: "",
            seq_num: 0,
            seq_year: 0,
            is_draft: false,
          })
          .execute();
        // Walk the real status flow so current_status is set by the same
        // constrained path as production, not written directly.
        for (const status of STATUS_FLOW.slice(1, STATUS_FLOW.indexOf("fulfilment") + 1)) {
          await trx
            .insertInto("order_status_events")
            .values({
              order_id: CURTAIN_ORDER,
              status,
              note: "[FIXTURE] seeded status",
              created_by: ACTOR,
            })
            .execute();
        }
        await trx
          .insertInto("rooms")
          .values({
            id: CURTAIN_ROOM,
            order_id: CURTAIN_ORDER,
            type: "Living Room",
            label: "Living Room",
            position: 1,
          })
          .execute();
        await trx
          .insertInto("windows")
          .values({
            id: CURTAIN_WINDOW,
            room_id: CURTAIN_ROOM,
            position: 1,
            width_cm: 210,
            height_cm: 260,
            draw: "Double",
            notes: "Ceiling mount",
            day_curtain_type_id: DAY_TYPE,
            night_curtain_type_id: NIGHT_TYPE,
          })
          .execute();
        await trx
          .insertInto("windows")
          .values({
            id: BLIND_WINDOW,
            room_id: CURTAIN_ROOM,
            position: 2,
            width_cm: 80,
            height_cm: 140,
            draw: "Single Left",
            notes: "Chain on left",
            blind_type_id: BLIND_TYPE,
          })
          .execute();
        for (const windowId of [CURTAIN_WINDOW, BLIND_WINDOW]) {
          await trx
            .insertInto("manufacture_measurements")
            .values({
              order_id: CURTAIN_ORDER,
              window_id: windowId,
              source_width_cm: 210,
              source_height_cm: 260,
              width_delta_cm: -5,
              height_delta_cm: -5,
              mfg_width_cm: 205,
              mfg_height_cm: 255,
            })
            .execute();
        }
        await trx
          .insertInto("fulfilment_arrangements")
          .values({
            id: CURTAIN_BOOKING,
            order_id: CURTAIN_ORDER,
            installer_token: CURTAIN_TOKEN,
            scheduled_at: new Date(Date.now() + 3 * 24 * 3600 * 1000),
            duration_mins: 90,
            address: "1 Fixture Way #01-01 Singapore 111111",
            created_by: ACTOR,
          })
          .execute();
      });
      console.log(`SEEDED curtain+blind order ${CURTAIN_ORDER}`);
    }

    // --- Mesh order -----------------------------------------------------------
    if (await exists(db, "orders", MESH_ORDER)) {
      console.log(`SKIP mesh order ${MESH_ORDER} — already exists`);
    } else {
      await db.transaction().execute(async (trx) => {
        await trx
          .insertInto("orders")
          .values({
            id: MESH_ORDER,
            customer_id: CUSTOMER,
            consultant_id: ACTOR,
            development: "INSTALL FIXTURE",
            product_line: "mesh",
            display_id: "",
            seq_num: 0,
            seq_year: 0,
            is_draft: false,
          })
          .execute();
        for (const status of STATUS_FLOW.slice(1, STATUS_FLOW.indexOf("fulfilment") + 1)) {
          await trx
            .insertInto("order_status_events")
            .values({
              order_id: MESH_ORDER,
              status,
              note: "[FIXTURE] seeded status",
              created_by: ACTOR,
            })
            .execute();
        }
        await trx
          .insertInto("rooms")
          .values({
            id: MESH_ROOM,
            order_id: MESH_ORDER,
            type: "Balcony",
            label: "Balcony",
            position: 1,
          })
          .execute();
        await trx
          .insertInto("mesh_panels")
          .values({
            id: MESH_PANEL,
            room_id: MESH_ROOM,
            position: 1,
            width_cm: 184,
            height_cm: 210,
            draw: "Double",
            notes: "Watch for railing",
          })
          .execute();
        await trx
          .insertInto("manufacture_measurements")
          .values({
            order_id: MESH_ORDER,
            mesh_panel_id: MESH_PANEL,
            source_width_cm: 184,
            source_height_cm: 210,
            width_delta_cm: -4,
            height_delta_cm: -5,
            mfg_width_cm: 180,
            mfg_height_cm: 205,
          })
          .execute();
        await trx
          .insertInto("fulfilment_arrangements")
          .values({
            id: MESH_BOOKING,
            order_id: MESH_ORDER,
            installer_token: MESH_TOKEN,
            scheduled_at: new Date(Date.now() + 3 * 24 * 3600 * 1000),
            duration_mins: 60,
            address: "2 Fixture Lane #02-02 Singapore 222222",
            created_by: ACTOR,
          })
          .execute();
      });
      console.log(`SEEDED mesh order ${MESH_ORDER}`);
    }

    const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3003";
    console.log("installation-details fixture ready:");
    console.log(`  curtain+blind order ${CURTAIN_ORDER}`);
    console.log(`    ${base}/install/${CURTAIN_TOKEN}`);
    console.log(`  mesh order          ${MESH_ORDER}`);
    console.log(`    ${base}/install/${MESH_TOKEN}`);
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
