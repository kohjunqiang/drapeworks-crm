import { sql, type Kysely } from "kysely";

// Remove the fabric catalogue. Phase 8 ("Option A") already switched the app
// to curtain_type_id; the fabrics table, the fabric_type/fabric_status enums,
// and the windows *_curtain_code columns (FK -> fabrics.code) have been dead
// since — never read, only written NULL. This drops them for good and
// simplifies validate_window_shape to the curtain-type-only rule.
//
// Reversible: down() restores the exact pre-removal schema (enums, fabrics
// table + RLS/triggers/indexes, the three windows code columns + FKs, and the
// Phase-8 shape trigger that still checked codes).

export async function up(db: Kysely<unknown>): Promise<void> {
  // 1. Simplify the shape guard so it no longer references the code columns.
  await sql`
    create or replace function public.validate_window_shape() returns trigger
    language plpgsql as $$
    declare
      v_room_type public.room_type;
      v_is_toilet boolean;
    begin
      select type into v_room_type from public.rooms where id = new.room_id;
      v_is_toilet := v_room_type in ('Master Toilet', 'Common Toilet');
      if v_is_toilet then
        if new.draw is not null
           or new.day_curtain_type_id is not null or new.night_curtain_type_id is not null then
          raise exception 'toilet windows must not have day/night curtain or draw';
        end if;
      else
        if new.curtain_type_id is not null then
          raise exception 'non-toilet windows must not have a single curtain (use day/night)';
        end if;
      end if;
      return new;
    end
    $$
  `.execute(db);

  // 2. Drop the windows code columns (removes their FK -> fabrics.code).
  await db.schema.alterTable("windows").dropColumn("night_curtain_code").execute();
  await db.schema.alterTable("windows").dropColumn("day_curtain_code").execute();
  await db.schema.alterTable("windows").dropColumn("curtain_code").execute();

  // 3. Drop fabrics (its triggers, indexes, and RLS policies drop with it).
  await db.schema.dropTable("fabrics").execute();

  // 4. Drop the now-unused fabric-code immutability guard function.
  await sql`drop function if exists public.guard_fabric_code_immutable()`.execute(db);

  // 5. Drop the fabric enums.
  await sql`drop type public.fabric_status`.execute(db);
  await sql`drop type public.fabric_type`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Enums.
  await sql`create type public.fabric_type as enum ('Day', 'Night', 'Both')`.execute(db);
  await sql`create type public.fabric_status as enum ('Active', 'Discontinued')`.execute(db);

  // fabrics table.
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
    .addColumn("created_by", "uuid", (col) => col.references("profiles.id"))
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

  await db.schema.createIndex("fabrics_status_idx").on("fabrics").column("status").execute();
  await db.schema.createIndex("fabrics_type_idx").on("fabrics").column("type").execute();

  await sql`alter table public.fabrics enable row level security`.execute(db);
  await sql`
    create policy "fabrics_select_authenticated"
      on public.fabrics for select to authenticated using (true)
  `.execute(db);
  await sql`
    create policy "fabrics_insert_admin"
      on public.fabrics for insert to authenticated
      with check (public.is_admin())
  `.execute(db);
  await sql`
    create policy "fabrics_update_admin"
      on public.fabrics for update to authenticated
      using (public.is_admin()) with check (public.is_admin())
  `.execute(db);

  // Re-add the windows code columns + FKs.
  await db.schema
    .alterTable("windows")
    .addColumn("curtain_code", "text", (col) => col.references("fabrics.code"))
    .execute();
  await db.schema
    .alterTable("windows")
    .addColumn("day_curtain_code", "text", (col) => col.references("fabrics.code"))
    .execute();
  await db.schema
    .alterTable("windows")
    .addColumn("night_curtain_code", "text", (col) => col.references("fabrics.code"))
    .execute();

  // Restore the Phase-8 shape trigger (checked both codes and type ids).
  await sql`
    create or replace function public.validate_window_shape() returns trigger
    language plpgsql as $$
    declare
      v_room_type public.room_type;
      v_is_toilet boolean;
    begin
      select type into v_room_type from public.rooms where id = new.room_id;
      v_is_toilet := v_room_type in ('Master Toilet', 'Common Toilet');
      if v_is_toilet then
        if new.day_curtain_code is not null or new.night_curtain_code is not null or new.draw is not null
           or new.day_curtain_type_id is not null or new.night_curtain_type_id is not null then
          raise exception 'toilet windows must not have day/night curtain or draw';
        end if;
      else
        if new.curtain_code is not null or new.curtain_type_id is not null then
          raise exception 'non-toilet windows must not have a single curtain (use day/night)';
        end if;
      end if;
      return new;
    end
    $$
  `.execute(db);
}
