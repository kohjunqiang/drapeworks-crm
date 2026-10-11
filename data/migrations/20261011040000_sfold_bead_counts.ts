import { sql, type Kysely } from "kysely";

// S-fold bead (runner) counts, frozen on the manufacturing record.
//
// An S-fold curtain's runner spacing is set by how many beads the track
// carries, and the vendor cuts to that count — so it belongs on the frozen
// record next to mfg_width_cm, not recomputed downstream. NULL means "never
// recorded": rows confirmed before this column existed stay null and keep
// deriving the count at PO time, so an already-issued order sheet never
// changes underneath a vendor.
//
// Shape mirrors the draw: a single-draw window stores sfold_bead_count; a
// double draw stores a count per leaf in sfold_bead_count_left/right. Exactly
// one of the two shapes may be present. Counts are positive EVEN integers —
// beads come in pairs and the vendor's spacing math assumes it.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("manufacture_measurements")
    .addColumn("sfold_bead_count", "integer")
    .addColumn("sfold_bead_count_left", "integer")
    .addColumn("sfold_bead_count_right", "integer")
    .execute();

  await sql`
    alter table public.manufacture_measurements
      add constraint mm_sfold_bead_shape_check check (
        (sfold_bead_count is null
          and sfold_bead_count_left is null
          and sfold_bead_count_right is null)
        or
        (sfold_bead_count is not null
          and sfold_bead_count_left is null
          and sfold_bead_count_right is null)
        or
        (sfold_bead_count is null
          and sfold_bead_count_left is not null
          and sfold_bead_count_right is not null)
      ),
      add constraint mm_sfold_bead_even_positive_check check (
        (sfold_bead_count is null
          or (sfold_bead_count > 0 and sfold_bead_count % 2 = 0))
        and
        (sfold_bead_count_left is null
          or (sfold_bead_count_left > 0 and sfold_bead_count_left % 2 = 0))
        and
        (sfold_bead_count_right is null
          or (sfold_bead_count_right > 0 and sfold_bead_count_right % 2 = 0))
      ),
      add constraint mm_sfold_bead_window_check check (
        sfold_bead_count is null
          and sfold_bead_count_left is null
          and sfold_bead_count_right is null
        or window_id is not null
      )
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table public.manufacture_measurements
      drop constraint mm_sfold_bead_window_check,
      drop constraint mm_sfold_bead_even_positive_check,
      drop constraint mm_sfold_bead_shape_check
  `.execute(db);
  await db.schema
    .alterTable("manufacture_measurements")
    .dropColumn("sfold_bead_count_right")
    .dropColumn("sfold_bead_count_left")
    .dropColumn("sfold_bead_count")
    .execute();
}
