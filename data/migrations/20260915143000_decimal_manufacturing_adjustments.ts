import { sql, type Kysely } from "kysely";

// Float8 keeps pg's JavaScript number representation used by pricing and forms.
// Widen frozen dimensions too so fractional consultations can reach manufacture.
const columns = {
  manufacture_measurements: ["width_delta_cm", "height_delta_cm", "mfg_split_left_cm", "mfg_split_right_cm"],
};

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table manufacture_measurements drop constraint mm_manufacturing_split_total_check,
    add constraint mm_manufacturing_split_total_check check (mfg_split_left_cm is null or abs(mfg_split_left_cm + mfg_split_right_cm - mfg_width_cm) < 0.000001)`.execute(db);
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
  await sql`alter table manufacture_measurements drop constraint mm_manufacturing_split_total_check,
    add constraint mm_manufacturing_split_total_check check (mfg_split_left_cm is null or mfg_split_left_cm + mfg_split_right_cm = mfg_width_cm)`.execute(db);

}
