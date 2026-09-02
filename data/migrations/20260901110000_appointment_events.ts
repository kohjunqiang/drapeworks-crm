import { sql, type Kysely } from "kysely";

// Appointment rows describe the latest state. Analytics needs an immutable
// history so a later reschedule, cancellation or delete cannot rewrite what
// happened. Every event keeps both appointment_id and lead_id: appointment_id
// gives the operational audit trail, while lead_id makes cohort drilldowns and
// cascaded lead removal explicit and efficient.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create type appointment_event_type as enum (
      'booked', 'rescheduled', 'completed', 'cancelled', 'no_show'
    )
  `.execute(db);

  await db.schema
    .createTable("appointment_events")
    .addColumn("id", "uuid", column => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("appointment_id", "uuid", column => column.notNull().references("appointments.id").onDelete("cascade"))
    .addColumn("lead_id", "uuid", column => column.notNull().references("leads.id").onDelete("cascade"))
    .addColumn("event_type", sql`appointment_event_type`, column => column.notNull())
    .addColumn("occurred_at", "timestamptz", column => column.notNull().defaultTo(sql`now()`))
    .addColumn("scheduled_at", "timestamptz")
    .addColumn("previous_scheduled_at", "timestamptz")
    .addColumn("created_by", "uuid", column => column.references("profiles.id").onDelete("set null"))
    .addColumn("is_backfilled", "boolean", column => column.notNull().defaultTo(false))
    .execute();

  await sql`create index appointment_events_appointment_occurred_idx on public.appointment_events (appointment_id, occurred_at)`.execute(db);
  await sql`create index appointment_events_lead_occurred_idx on public.appointment_events (lead_id, occurred_at)`.execute(db);

  // Preserve the structured history that exists before the event ledger. The
  // backfill flag lets Analytics disclose that these timestamps were inferred
  // from the current appointment row rather than captured live.
  await sql`
    insert into public.appointment_events (
      appointment_id, lead_id, event_type, occurred_at, scheduled_at,
      created_by, is_backfilled
    )
    select id, lead_id, 'booked'::appointment_event_type, created_at,
      scheduled_at, created_by, true
    from public.appointments
  `.execute(db);

  await sql`
    insert into public.appointment_events (
      appointment_id, lead_id, event_type, occurred_at, scheduled_at,
      created_by, is_backfilled
    )
    select id, lead_id, status::text::appointment_event_type, updated_at,
      scheduled_at, created_by, true
    from public.appointments
    where status in ('completed', 'cancelled', 'no_show')
  `.execute(db);

  await sql`alter table public.appointment_events enable row level security`.execute(db);
  await sql`
    create policy "appointment_events_select_consultant_admin"
      on public.appointment_events for select to authenticated
      using (public.is_consultant() or public.is_admin())
  `.execute(db);
  await sql`
    create policy "appointment_events_insert_consultant_admin"
      on public.appointment_events for insert to authenticated
      with check (
        (public.is_consultant() or public.is_admin())
        and created_by = auth.uid()
      )
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("appointment_events").execute();
  await sql`drop type appointment_event_type`.execute(db);
}
