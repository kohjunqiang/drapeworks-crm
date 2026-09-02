import { sql, type Kysely } from "kysely";

// One editable installation booking per order. Consultation appointments are
// intentionally not reused: they are lead-scoped and carry funnel side effects
// that an installation must never trigger.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("fulfilment_arrangements")
    .addColumn("id", "uuid", (column) =>
      column.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("order_id", "uuid", (column) =>
      column.notNull().unique().references("orders.id").onDelete("restrict"),
    )
    .addColumn("scheduled_at", "timestamptz", (column) => column.notNull())
    .addColumn("duration_mins", "integer", (column) =>
      column.notNull().defaultTo(60),
    )
    .addColumn("address", "text", (column) => column.notNull())
    .addColumn("google_event_id", "text")
    .addColumn("google_sync_state", sql`google_sync_state`, (column) =>
      column.notNull().defaultTo("pending"),
    )
    .addColumn("google_sync_error", "text")
    .addColumn("created_by", "uuid", (column) =>
      column.references("profiles.id").onDelete("set null"),
    )
    .addColumn("created_at", "timestamptz", (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addColumn("updated_at", "timestamptz", (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await sql`
    alter table public.fulfilment_arrangements
      add constraint fulfilment_arrangements_duration_check
      check (duration_mins between 15 and 480)
  `.execute(db);

  await sql`
    create trigger fulfilment_arrangements_set_updated_at
      before update on public.fulfilment_arrangements
      for each row execute function public.set_updated_at()
  `.execute(db);

  await sql`
    create index fulfilment_arrangements_scheduled_at_idx
      on public.fulfilment_arrangements (scheduled_at)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("fulfilment_arrangements").execute();
}
