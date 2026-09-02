import { sql, type Kysely } from "kysely";

// The current arrangement row is editable operational state. This table is the
// append-only audit trail that survives rescheduling, cancellation and rebooking.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create type public.fulfilment_arrangement_event_type as enum (
      'booked', 'rescheduled', 'cancelled'
    )
  `.execute(db);

  await db.schema
    .createTable("fulfilment_arrangement_events")
    .addColumn("id", "uuid", (column) =>
      column.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("arrangement_id", "uuid", (column) =>
      column
        .notNull()
        .references("fulfilment_arrangements.id")
        .onDelete("restrict"),
    )
    .addColumn(
      "event_type",
      sql`public.fulfilment_arrangement_event_type`,
      (column) => column.notNull(),
    )
    .addColumn("scheduled_at", "timestamptz", (column) => column.notNull())
    .addColumn("duration_mins", "integer", (column) => column.notNull())
    .addColumn("address", "text", (column) => column.notNull())
    .addColumn("cancellation_reason", "text")
    .addColumn("created_by", "uuid", (column) =>
      column.references("profiles.id").onDelete("set null"),
    )
    .addColumn("created_at", "timestamptz", (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await sql`
    alter table public.fulfilment_arrangement_events
      add constraint fulfilment_arrangement_events_duration_check
      check (duration_mins between 15 and 480),
      add constraint fulfilment_arrangement_events_reason_check
      check (
        (event_type = 'cancelled' and nullif(btrim(cancellation_reason), '') is not null)
        or (event_type <> 'cancelled' and cancellation_reason is null)
      )
  `.execute(db);

  await sql`
    create index fulfilment_arrangement_events_arrangement_created_idx
      on public.fulfilment_arrangement_events (arrangement_id, created_at desc)
  `.execute(db);
  await db.schema
    .createIndex("fulfilment_arrangement_events_created_by_idx")
    .on("fulfilment_arrangement_events")
    .column("created_by")
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("fulfilment_arrangement_events").execute();
  await sql`drop type public.fulfilment_arrangement_event_type`.execute(db);
}
