import { sql, type Kysely } from "kysely";

// Phase 15 — the appointment record the spreadsheet never had. The sheet's
// closest field is 'Action Date': a date with no time, no duration and no
// address, which is not enough to put on a calendar.

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create type appointment_status as enum (
      'scheduled', 'completed', 'cancelled', 'no_show'
    )
  `.execute(db);

  // Sync is a side effect, never a gate. A booking saves as 'pending' and is
  // pushed to Google after the transaction commits, so a Google outage costs
  // a calendar entry, not an appointment.
  await sql`
    create type google_sync_state as enum ('pending', 'synced', 'failed')
  `.execute(db);

  await db.schema
    .createTable("appointments")
    .addColumn("id", "uuid", (c) =>
      c.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("lead_id", "uuid", (c) =>
      c.notNull().references("leads.id").onDelete("restrict"),
    )
    .addColumn("customer_id", "uuid", (c) =>
      c.notNull().references("customers.id").onDelete("restrict"),
    )
    .addColumn("scheduled_at", "timestamptz", (c) => c.notNull())
    .addColumn("duration_mins", "integer", (c) => c.notNull().defaultTo(90))
    .addColumn("development", "text")
    .addColumn("address", "text")
    .addColumn("notes", "text")
    .addColumn("status", sql`appointment_status`, (c) =>
      c.notNull().defaultTo("scheduled"),
    )
    // Booking overwrites three lead fields — funnel_stage, last_outcome and
    // action_date. All three are recorded so cancelling can restore rather
    // than guess; a lead booked from Nurture or Quote Sent would otherwise be
    // rolled *forward* into a stage it was never in.
    //
    // ALL THREE, not just the stage. Each one reaches the engine:
    //   - the cascade runs outcome branches above stage branches, so a fresh
    //     outcome makes a restored stage unreachable;
    //   - action_date feeds deriveEffectiveActionDate, which feeds both due
    //     status and contact priority, so clearing it moves the row's band.
    // 53 leads carry an action_date today. 11 of them are Nurture, and those
    // reach a booking only after being moved to a bookable stage — which does
    // not clear the date. So the stage restored is the one Alan set, and it is
    // the date that has to survive. See setAppointmentStatus.
    .addColumn("lead_stage_before", sql`lead_funnel_stage`)
    .addColumn("lead_outcome_before", sql`lead_outcome`)
    .addColumn("lead_action_date_before", "date")
    .addColumn("google_event_id", "text")
    .addColumn("google_sync_state", sql`google_sync_state`, (c) =>
      c.notNull().defaultTo("pending"),
    )
    .addColumn("google_sync_error", "text")
    .addColumn("created_by", "uuid", (c) => c.references("profiles.id"))
    .addColumn("created_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .addColumn("updated_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .execute();

  // House convention: public.set_updated_at() already exists and every table
  // that carries updated_at is bumped by a trigger, not by hand. See
  // 202608211000_delivery_vendors.ts. Relying on the Server Actions to remember
  // would leave calendar-sync writes stale, since those update the row without
  // going through an action that sets it.
  await sql`
    create trigger appointments_set_updated_at
      before update on public.appointments
      for each row execute function public.set_updated_at()
  `.execute(db);

  await sql`
    create trigger leads_set_updated_at
      before update on public.leads
      for each row execute function public.set_updated_at()
  `.execute(db);

  await sql`create index appointments_lead_id_idx on public.appointments (lead_id)`.execute(db);
  await sql`create index appointments_scheduled_at_idx on public.appointments (scheduled_at)`.execute(db);

  // The Won -> order seam. The lead is reachable through the appointment, so
  // orders carry no separate lead_id.
  await db.schema
    .alterTable("orders")
    .addColumn("appointment_id", "uuid", (c) =>
      c.references("appointments.id").onDelete("set null"),
    )
    .execute();

  // NOT unique. Per-order customer creation has already produced duplicate
  // mobiles in this table; a unique constraint would fail on contact.
  //
  // Indexed on the normalised form, because that is what the picker searches.
  // Stored formats are mixed — 40 leads carry '98439326', 58 carry
  // '+6581817358' — so the lookup reduces both sides to the last 8 digits. A
  // plain index on the raw column could never serve that predicate and would
  // be dead weight for the only query that searches mobile.
  await sql`
    create index customers_mobile_last8_idx
      on public.customers (right(regexp_replace(mobile, '\\D', '', 'g'), 8))
  `.execute(db);

  await sql`alter table public.appointments enable row level security`.execute(db);
  await sql`
    create policy "appointments_select_authenticated"
      on public.appointments for select to authenticated using (true)
  `.execute(db);
  await sql`
    create policy "appointments_write_authenticated"
      on public.appointments for all to authenticated using (true) with check (true)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop trigger if exists leads_set_updated_at on public.leads`.execute(db);
  await sql`drop index if exists customers_mobile_last8_idx`.execute(db);
  await db.schema.alterTable("orders").dropColumn("appointment_id").execute();
  await db.schema.dropTable("appointments").execute();
  await sql`drop type google_sync_state`.execute(db);
  await sql`drop type appointment_status`.execute(db);
}
