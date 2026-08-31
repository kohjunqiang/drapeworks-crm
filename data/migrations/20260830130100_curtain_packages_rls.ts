import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table public.curtain_packages enable row level security`.execute(db);
  await sql`
    create policy "curtain_packages_select_authenticated"
      on public.curtain_packages for select to authenticated using (true)
  `.execute(db);
  await sql`
    create policy "curtain_packages_insert_admin"
      on public.curtain_packages for insert to authenticated
      with check (public.is_admin())
  `.execute(db);
  await sql`
    create policy "curtain_packages_update_admin"
      on public.curtain_packages for update to authenticated
      using (public.is_admin()) with check (public.is_admin())
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    drop policy if exists "curtain_packages_update_admin"
      on public.curtain_packages
  `.execute(db);
  await sql`
    drop policy if exists "curtain_packages_insert_admin"
      on public.curtain_packages
  `.execute(db);
  await sql`
    drop policy if exists "curtain_packages_select_authenticated"
      on public.curtain_packages
  `.execute(db);
}
