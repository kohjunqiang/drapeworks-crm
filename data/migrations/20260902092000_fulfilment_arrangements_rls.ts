import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table public.fulfilment_arrangements enable row level security
  `.execute(db);

  await sql`
    create policy "fulfilment_arrangements_select_authenticated"
      on public.fulfilment_arrangements for select to authenticated
      using (true)
  `.execute(db);

  await sql`
    create policy "fulfilment_arrangements_insert_ops_admin"
      on public.fulfilment_arrangements for insert to authenticated
      with check (public.is_ops() or public.is_admin())
  `.execute(db);

  await sql`
    create policy "fulfilment_arrangements_update_ops_admin"
      on public.fulfilment_arrangements for update to authenticated
      using (public.is_ops() or public.is_admin())
      with check (public.is_ops() or public.is_admin())
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    drop policy if exists "fulfilment_arrangements_update_ops_admin"
      on public.fulfilment_arrangements
  `.execute(db);
  await sql`
    drop policy if exists "fulfilment_arrangements_insert_ops_admin"
      on public.fulfilment_arrangements
  `.execute(db);
  await sql`
    drop policy if exists "fulfilment_arrangements_select_authenticated"
      on public.fulfilment_arrangements
  `.execute(db);
}
