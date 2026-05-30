import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`create type public.fabric_type as enum ('Day', 'Night', 'Both')`.execute(db);
  await sql`create type public.fabric_status as enum ('Active', 'Discontinued')`.execute(db);

  await db.schema
    .createTable("fabrics")
    .addColumn("code", "text", (col) => col.primaryKey())
    .addColumn("name", "text", (col) => col.notNull())
    .addColumn("type", sql`public.fabric_type`, (col) => col.notNull())
    .addColumn("supplier", "text")
    .addColumn("color", "text", (col) =>
      col.notNull().check(sql`color ~ '^#[0-9a-fA-F]{6}$'`),
    )
    .addColumn("status", sql`public.fabric_status`, (col) =>
      col.notNull().defaultTo(sql`'Active'::public.fabric_status`),
    )
    .addColumn("notes", "text")
    .addColumn("created_by", "uuid")
    .addColumn("created_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn("updated_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await sql`
    create trigger fabrics_set_updated_at
      before update on public.fabrics
      for each row execute function public.set_updated_at()
  `.execute(db);

  await sql`
    create or replace function public.guard_fabric_code_immutable() returns trigger
    language plpgsql as $$
    begin
      if (new.code is distinct from old.code) then
        raise exception 'fabric code is immutable';
      end if;
      return new;
    end
    $$
  `.execute(db);

  await sql`
    create trigger fabrics_guard_code
      before update on public.fabrics
      for each row execute function public.guard_fabric_code_immutable()
  `.execute(db);

  await db.schema
    .createIndex("fabrics_status_idx")
    .on("fabrics")
    .column("status")
    .execute();

  await db.schema
    .createIndex("fabrics_type_idx")
    .on("fabrics")
    .column("type")
    .execute();

  await sql`alter table public.fabrics enable row level security`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop trigger if exists fabrics_guard_code on public.fabrics`.execute(db);
  await sql`drop function if exists public.guard_fabric_code_immutable()`.execute(db);
  await sql`drop trigger if exists fabrics_set_updated_at on public.fabrics`.execute(db);
  await db.schema.dropTable("fabrics").ifExists().execute();
  await sql`drop type if exists public.fabric_status`.execute(db);
  await sql`drop type if exists public.fabric_type`.execute(db);
}
