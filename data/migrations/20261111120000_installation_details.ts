import { sql, type Kysely } from "kysely";

// Ops can correct what the installer actually sees — clearer instructions, a
// room note, or a size adjusted on site — without touching the quoted windows,
// the measured site dimensions, or the frozen PO measurements. Those stay
// immutable; the corrections live as bounded overrides on the booking itself.
// `installation_details` is null until the first save; `installation_details_
// version` is the optimistic-concurrency token the save action checks so two
// tabs cannot silently overwrite each other.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("fulfilment_arrangements")
    .addColumn("installation_details", "jsonb")
    .execute();

  await sql`
    alter table public.fulfilment_arrangements
      add constraint fulfilment_arrangements_installation_details_object
      check (installation_details is null or jsonb_typeof(installation_details) = 'object')
  `.execute(db);

  await db.schema
    .alterTable("fulfilment_arrangements")
    .addColumn("installation_details_version", "integer", (column) =>
      column.notNull().defaultTo(0),
    )
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("fulfilment_arrangements")
    .dropConstraint("fulfilment_arrangements_installation_details_object")
    .execute();

  await db.schema
    .alterTable("fulfilment_arrangements")
    .dropColumn("installation_details")
    .dropColumn("installation_details_version")
    .execute();
}
