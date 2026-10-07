import "dotenv/config";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import { up, down } from "../data/migrations/20261007120000_mesh_decimal_splits";

// Rollback-only rehearsal for the mesh_panels split widening. A TEMP table
// named mesh_panels shadows the real one inside this session — the migration's
// unqualified `alter table mesh_panels` then hits the disposable table, and
// the wrapping transaction rolls back regardless. No production writes.

async function columnType(db: Kysely<unknown>, column: string): Promise<string> {
  const r = await sql<{ t: string }>`
    select atttypid::regtype::text as t
    from pg_catalog.pg_attribute
    where attrelid = 'mesh_panels'::regclass and attname = ${column}
  `.execute(db);
  return r.rows[0].t;
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  const local = /^postgres(?:ql)?:\/\/(?:[^@/]+@)?(?:localhost|127\.0\.0\.1)(?::|\/)/.test(connectionString);
  const db = new Kysely<unknown>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString, ssl: local ? false : { rejectUnauthorized: false }, max: 1 }) }) });
  await sql`begin`.execute(db);
  try {
    await sql`create temp table mesh_panels (
      id uuid primary key default gen_random_uuid(),
      room_id uuid not null,
      position integer not null,
      split_left_cm integer,
      split_right_cm integer
    )`.execute(db);
    await sql`insert into mesh_panels (room_id, position) values (gen_random_uuid(), 0)`.execute(db);
    await sql`insert into mesh_panels (room_id, position, split_left_cm, split_right_cm) values (gen_random_uuid(), 1, 120, 119)`.execute(db);

    await up(db);
    for (const col of ["split_left_cm", "split_right_cm"]) {
      const t = await columnType(db, col);
      if (t !== "double precision") throw new Error(`up: ${col} is ${t}, expected double precision`);
    }
    // Widening must preserve existing rows verbatim: nulls stay null, integers
    // stay integral.
    const preserved = (await sql<{ l: number | null; r: number | null }>`
      select split_left_cm as l, split_right_cm as r from mesh_panels order by position
    `.execute(db)).rows;
    if (preserved.length !== 2 || preserved[0].l !== null || preserved[0].r !== null) {
      throw new Error(`up: null row not preserved: ${JSON.stringify(preserved[0])}`);
    }
    if (preserved[1].l !== 120 || preserved[1].r !== 119) {
      throw new Error(`up: integer row not preserved: ${JSON.stringify(preserved[1])}`);
    }
    await sql`insert into mesh_panels (room_id, position, split_left_cm, split_right_cm) values (gen_random_uuid(), 2, 120, 119.5)`.execute(db);
    const decimal = (await sql<{ l: number; r: number }>`
      select split_left_cm as l, split_right_cm as r from mesh_panels where position = 2
    `.execute(db)).rows[0];
    if (decimal.l !== 120 || decimal.r !== 119.5) {
      throw new Error(`up: decimal round-trip failed: ${JSON.stringify(decimal)}`);
    }

    let refused = false;
    try {
      await down(db);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message !== "Cannot revert while decimal measurements exist") throw error;
      refused = true;
    }
    if (!refused) throw new Error("down: reverted despite a fractional value — must refuse instead of rounding");
    if ((await columnType(db, "split_right_cm")) !== "double precision") {
      throw new Error("down: narrowed a column before refusing — refusal must precede any alter");
    }

    await sql`delete from mesh_panels where position = 2`.execute(db);
    await down(db);
    for (const col of ["split_left_cm", "split_right_cm"]) {
      const t = await columnType(db, col);
      if (t !== "integer") throw new Error(`down: ${col} is ${t}, expected integer`);
    }
    const kept = (await sql<{ n: number }>`select count(*)::int as n from mesh_panels`.execute(db)).rows[0].n;
    if (kept !== 2) throw new Error(`down: expected 2 surviving rows, found ${kept}`);

    console.log("Mesh split widening rehearsal passed: up widens to float8, down refuses fractional values, down reverts clean data to integer. Rolling back.");
  } finally {
    await sql`rollback`.execute(db);
    await db.destroy();
  }
}

main().catch(error => { console.error(error); process.exit(1); });
