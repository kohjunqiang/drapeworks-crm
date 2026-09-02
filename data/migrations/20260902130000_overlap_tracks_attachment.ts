import { type Kysely } from "kysely";

// Operational instruction for the track supplier. It is not a priced add-on,
// so it sits with the window's other installation flags and is copied into the
// generated track order text.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("windows")
    .addColumn("overlap_tracks_attachment", "boolean", (column) =>
      column.notNull().defaultTo(false),
    )
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("windows")
    .dropColumn("overlap_tracks_attachment")
    .execute();
}
