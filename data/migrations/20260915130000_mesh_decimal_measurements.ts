import { sql, type Kysely } from "kysely";

// Float8 keeps pg's JavaScript number representation used by pricing and forms.
// Widen frozen dimensions too so fractional consultations can reach manufacture.
const columns = {
  mesh_panels: ["width_cm", "height_cm"],
  manufacture_measurements: ["source_width_cm", "source_height_cm", "mfg_width_cm", "mfg_height_cm"],
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
