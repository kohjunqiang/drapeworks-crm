import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  // Booking is allowed more than once over a lead's lifetime, but never twice
  // at the same time. The action also locks the lead row; this index is the
  // final backstop for direct or concurrent database writes.
  await sql`
    do $$
    begin
      if exists (
        select 1
        from public.appointments
        where status = 'scheduled'
        group by lead_id
        having count(*) > 1
      ) then
        raise exception 'cannot enforce one scheduled appointment per lead: duplicates exist';
      end if;
    end
    $$
  `.execute(db);
  await sql`
    create unique index appointments_one_scheduled_per_lead
      on public.appointments (lead_id)
      where status = 'scheduled'
  `.execute(db);

  // Appointment state is changed through audited Server Actions. Direct Data
  // API writes would bypass lead-stage events and Google Calendar cleanup.
  await sql`
    drop policy if exists "appointments_write_authenticated"
      on public.appointments
  `.execute(db);
  await sql`
    drop policy if exists "appointments_select_authenticated"
      on public.appointments
  `.execute(db);
  await sql`
    create policy "appointments_select_consultant_admin"
      on public.appointments for select to authenticated
      using (public.is_consultant() or public.is_admin())
  `.execute(db);
  await sql`
    revoke insert, update, delete on public.appointments from authenticated
  `.execute(db);

  // Status events drive orders.current_status through a trigger. They must use
  // the locked Server Actions too; a direct stale note can otherwise look like
  // a valid one-step revert to the transition trigger.
  await sql`
    drop policy if exists "ose_insert_advance_or_note"
      on public.order_status_events
  `.execute(db);
  await sql`
    revoke insert on public.order_status_events from authenticated
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    grant insert on public.order_status_events to authenticated
  `.execute(db);
  await sql`
    create policy "ose_insert_advance_or_note" on public.order_status_events
      for insert to authenticated
      with check (
        public.is_ops()
        or public.is_admin()
        or (
          public.is_consultant()
          and exists (
            select 1 from public.orders o
            where o.id = order_status_events.order_id
              and o.consultant_id = auth.uid()
              and o.current_status = order_status_events.status
          )
          and order_status_events.note is not null
          and length(order_status_events.note) > 0
        )
      )
  `.execute(db);
  await sql`
    grant insert, update, delete on public.appointments to authenticated
  `.execute(db);
  await sql`
    drop policy if exists "appointments_select_consultant_admin"
      on public.appointments
  `.execute(db);
  await sql`
    create policy "appointments_select_authenticated"
      on public.appointments for select to authenticated using (true)
  `.execute(db);
  await sql`
    create policy "appointments_write_authenticated"
      on public.appointments for all to authenticated
      using (true) with check (true)
  `.execute(db);
  await db.schema.dropIndex("appointments_one_scheduled_per_lead").execute();
}
