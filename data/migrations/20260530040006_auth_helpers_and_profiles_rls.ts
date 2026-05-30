import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create or replace function public.current_role() returns public.user_role
    language sql stable security definer set search_path = public as $$
      select role from public.profiles where id = auth.uid()
    $$
  `.execute(db);

  await sql`
    create or replace function public.is_admin() returns boolean
    language sql stable as $$
      select coalesce(public.current_role() = 'admin', false)
    $$
  `.execute(db);

  await sql`
    create or replace function public.is_ops() returns boolean
    language sql stable as $$
      select coalesce(public.current_role() = 'ops', false)
    $$
  `.execute(db);

  await sql`
    create or replace function public.is_consultant() returns boolean
    language sql stable as $$
      select coalesce(public.current_role() = 'consultant', false)
    $$
  `.execute(db);

  await sql`
    create policy "profiles_select_authenticated"
      on public.profiles for select to authenticated
      using (true)
  `.execute(db);

  await sql`
    create policy "profiles_update_own"
      on public.profiles for update to authenticated
      using (id = auth.uid())
      with check (id = auth.uid())
  `.execute(db);

  await sql`
    create policy "profiles_update_admin"
      on public.profiles for update to authenticated
      using (public.is_admin())
      with check (public.is_admin())
  `.execute(db);

  await sql`
    create policy "profiles_delete_admin"
      on public.profiles for delete to authenticated
      using (public.is_admin())
  `.execute(db);

  await sql`
    create or replace function public.guard_profile_role_update() returns trigger
    language plpgsql security definer set search_path = public as $$
    begin
      if (new.role is distinct from old.role) and not public.is_admin() then
        raise exception 'only admins can change role';
      end if;
      return new;
    end
    $$
  `.execute(db);

  await sql`
    create trigger profiles_guard_role_update
      before update on public.profiles
      for each row execute function public.guard_profile_role_update()
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop trigger if exists profiles_guard_role_update on public.profiles`.execute(db);
  await sql`drop function if exists public.guard_profile_role_update()`.execute(db);
  await sql`drop policy if exists "profiles_delete_admin" on public.profiles`.execute(db);
  await sql`drop policy if exists "profiles_update_admin" on public.profiles`.execute(db);
  await sql`drop policy if exists "profiles_update_own" on public.profiles`.execute(db);
  await sql`drop policy if exists "profiles_select_authenticated" on public.profiles`.execute(db);
  await sql`drop function if exists public.is_consultant()`.execute(db);
  await sql`drop function if exists public.is_ops()`.execute(db);
  await sql`drop function if exists public.is_admin()`.execute(db);
  await sql`drop function if exists public.current_role()`.execute(db);
}
