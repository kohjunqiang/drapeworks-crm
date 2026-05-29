import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`create extension if not exists "pgcrypto"`.execute(db);

  await sql`create type public.user_role as enum ('consultant', 'ops', 'admin')`.execute(db);

  await db.schema
    .createTable("profiles")
    .addColumn("id", "uuid", (col) =>
      col.primaryKey().references("auth.users.id").onDelete("cascade"),
    )
    .addColumn("email", "text", (col) => col.notNull())
    .addColumn("full_name", "text")
    .addColumn("role", sql`public.user_role`, (col) =>
      col.notNull().defaultTo(sql`'consultant'::public.user_role`),
    )
    .addColumn("is_active", "boolean", (col) => col.notNull().defaultTo(true))
    .addColumn("created_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn("updated_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await sql`
    create or replace function public.set_updated_at() returns trigger
    language plpgsql as $$
    begin
      new.updated_at = now();
      return new;
    end
    $$
  `.execute(db);

  await sql`
    create trigger profiles_set_updated_at
      before update on public.profiles
      for each row execute function public.set_updated_at()
  `.execute(db);

  await sql`
    create or replace function public.handle_new_auth_user() returns trigger
    language plpgsql security definer set search_path = public as $$
    begin
      insert into public.profiles (id, email, full_name)
      values (
        new.id,
        new.email,
        coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1))
      );
      return new;
    end
    $$
  `.execute(db);

  await sql`
    create trigger on_auth_user_created
      after insert on auth.users
      for each row execute function public.handle_new_auth_user()
  `.execute(db);

  await sql`alter table public.profiles enable row level security`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop trigger if exists on_auth_user_created on auth.users`.execute(db);
  await sql`drop function if exists public.handle_new_auth_user()`.execute(db);
  await sql`drop trigger if exists profiles_set_updated_at on public.profiles`.execute(db);
  await sql`drop function if exists public.set_updated_at()`.execute(db);
  await db.schema.dropTable("profiles").ifExists().execute();
  await sql`drop type if exists public.user_role`.execute(db);
}
