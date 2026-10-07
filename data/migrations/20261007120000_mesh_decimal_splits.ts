import { sql, type Kysely } from "kysely";

// Float8 keeps pg's JavaScript number representation used by pricing and forms.
// Double-draw leaf widths fall on fractions of a centimetre (120 + 119.5 across
// a 239.5 opening), matching the width/height widening in
// 20260915130000_mesh_decimal_measurements.
const columns = {
  mesh_panels: ["split_left_cm", "split_right_cm"],
};

export async function up(db: Kysely<unknown>): Promise<void> {
  for (const [table, fields] of Object.entries(columns)) {
    for (const field of fields) {
      await sql`alter table ${sql.table(table)} alter column ${sql.ref(field)} type double precision`.execute(db);
    }
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Never silently round customer measurements when reverting.
  for (const [table, fields] of Object.entries(columns)) {
    for (const field of fields) {
      const fractional = await sql`select 1 from ${sql.table(table)} where ${sql.ref(field)} <> trunc(${sql.ref(field)}) limit 1`.execute(db);
      if (fractional.rows.length) throw new Error("Cannot revert while decimal measurements exist");
    }
  }
  for (const [table, fields] of Object.entries(columns)) {
    for (const field of fields) {
      await sql`alter table ${sql.table(table)} alter column ${sql.ref(field)} type integer`.execute(db);
    }
  }
}
