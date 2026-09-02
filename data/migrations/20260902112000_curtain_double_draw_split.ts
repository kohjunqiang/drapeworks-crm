import { sql, type Kysely } from "kysely";

// A double-draw curtain normally meets in the centre, but some openings need
// an off-centre meeting point. Keep the overall opening width as the source
// measurement and record the optional left/right allocation alongside it.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("windows")
    .addColumn("split_left_cm", "integer")
    .addColumn("split_right_cm", "integer")
    .execute();

  // Pair-and-total validation belongs to final-order validation: a draft must
  // remain savable while only one side has been entered or while the total is
  // being corrected. The database still rejects impossible ranges and a split
  // attached to a single draw.
  await sql`
    alter table public.windows
      add constraint windows_curtain_split_draw_check check (
        (split_left_cm is null and split_right_cm is null)
        or draw = 'Double'
      ),
      add constraint windows_curtain_split_measurement_check check (
        (split_left_cm is null or (split_left_cm > 0 and split_left_cm <= 1000))
        and
        (split_right_cm is null or (split_right_cm > 0 and split_right_cm <= 1000))
      )
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("windows")
    .dropColumn("split_right_cm")
    .dropColumn("split_left_cm")
    .execute();
}
