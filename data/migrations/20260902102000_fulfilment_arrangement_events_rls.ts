import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table public.fulfilment_arrangement_events enable row level security
  `.execute(db);
  await sql`
    create policy "fulfilment_arrangement_events_select_authenticated"
      on public.fulfilment_arrangement_events for select to authenticated
      using (true)
  `.execute(db);
  await sql`
    create policy "fulfilment_arrangement_events_insert_ops_admin"
      on public.fulfilment_arrangement_events for insert to authenticated
      with check (public.is_ops() or public.is_admin())
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    drop policy if exists "fulfilment_arrangement_events_insert_ops_admin"
      on public.fulfilment_arrangement_events
  `.execute(db);
  await sql`
    drop policy if exists "fulfilment_arrangement_events_select_authenticated"
      on public.fulfilment_arrangement_events
  `.execute(db);
  await sql`
    alter table public.fulfilment_arrangement_events disable row level security
  `.execute(db);
}
