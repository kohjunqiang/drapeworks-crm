import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("manufacture_measurements")
    .addColumn("mfg_split_left_cm", "integer")
    .addColumn("mfg_split_right_cm", "integer")
    .execute();

  // Preserve existing confirmed orders. The consultation split is measured
  // against the opening, so carry its ratio onto the frozen manufacturing
  // width and make the right side absorb the rounding remainder.
  await sql`
    update public.manufacture_measurements mm
       set mfg_split_left_cm = round(
             mm.mfg_width_cm::numeric * w.split_left_cm
             / (w.split_left_cm + w.split_right_cm)
           )::integer,
           mfg_split_right_cm = mm.mfg_width_cm - round(
             mm.mfg_width_cm::numeric * w.split_left_cm
             / (w.split_left_cm + w.split_right_cm)
           )::integer
      from public.windows w
     where mm.window_id = w.id
       and w.split_left_cm is not null
       and w.split_right_cm is not null
  `.execute(db);

  await sql`
    alter table public.manufacture_measurements
      add constraint mm_manufacturing_split_pair_check check (
        (mfg_split_left_cm is null and mfg_split_right_cm is null)
        or
        (mfg_split_left_cm > 0 and mfg_split_right_cm > 0)
      ),
      add constraint mm_manufacturing_split_total_check check (
        mfg_split_left_cm is null
        or mfg_split_left_cm + mfg_split_right_cm = mfg_width_cm
      ),
      add constraint mm_manufacturing_split_window_check check (
        mfg_split_left_cm is null or window_id is not null
      )
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table public.manufacture_measurements
      drop constraint mm_manufacturing_split_window_check,
      drop constraint mm_manufacturing_split_total_check,
      drop constraint mm_manufacturing_split_pair_check
  `.execute(db);
  await db.schema
    .alterTable("manufacture_measurements")
    .dropColumn("mfg_split_right_cm")
    .dropColumn("mfg_split_left_cm")
    .execute();
}
