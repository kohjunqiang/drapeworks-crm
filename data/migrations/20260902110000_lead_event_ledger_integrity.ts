import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  // These tables are written only through audited Server Actions. Direct Data
  // API writes can otherwise fabricate funnel/appointment analytics or mutate
  // a lead without the corresponding event ledger.
  await sql`
    drop policy if exists "appointment_events_insert_consultant_admin"
      on public.appointment_events;
    revoke insert, update, delete on public.appointment_events from authenticated;

    drop policy if exists lead_stage_events_write_authenticated
      on public.lead_stage_events;
    revoke insert, update, delete on public.lead_stage_events from authenticated;

    drop policy if exists lead_interactions_write_authenticated
      on public.lead_interactions;
    revoke insert, update, delete on public.lead_interactions from authenticated;

    drop policy if exists "leads_write_authenticated" on public.leads;
    revoke insert, update, delete on public.leads from authenticated;
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    grant insert on public.appointment_events to authenticated;
    create policy "appointment_events_insert_consultant_admin"
      on public.appointment_events for insert to authenticated
      with check (
        (public.is_consultant() or public.is_admin())
        and created_by = auth.uid()
      );

    grant insert, update, delete on public.lead_stage_events to authenticated;
    create policy lead_stage_events_write_authenticated
      on public.lead_stage_events for all to authenticated
      using (true) with check (true);

    grant insert, update, delete on public.lead_interactions to authenticated;
    create policy lead_interactions_write_authenticated
      on public.lead_interactions for all to authenticated
      using (true) with check (true);

    grant insert, update, delete on public.leads to authenticated;
    create policy "leads_write_authenticated"
      on public.leads for all to authenticated
      using (true) with check (true);
  `.execute(db);
}
