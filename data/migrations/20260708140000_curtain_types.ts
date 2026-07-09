import { sql, type Kysely } from "kysely";

// Phase 8 — photo-backed curtain-type catalog (option A: the consultation
// form's Day/Night pickers now choose curtain *types* instead of fabric
// codes). Additive and non-destructive: the old *_curtain_code columns on
// windows stay so existing orders are untouched.
//
// Mirrors the fabrics table + RLS and the room-photos storage bucket.

export async function up(db: Kysely<unknown>): Promise<void> {
  // ── enums ─────────────────────────────────────────────────────────────
  await sql`create type public.curtain_category as enum ('Day', 'Night')`.execute(
    db,
  );
  await sql`create type public.curtain_type_status as enum ('Active', 'Archived')`.execute(
    db,
  );

  // ── curtain_types ─────────────────────────────────────────────────────
  await db.schema
    .createTable("curtain_types")
    .addColumn("id", "uuid", (c) =>
      c.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("label", "text", (c) => c.notNull())
    .addColumn("category", sql`public.curtain_category`, (c) => c.notNull())
    // Single hero photo — store the Storage object path, sign a read URL per
    // render. Nullable so a type can be saved before its photo is uploaded.
    .addColumn("photo_path", "text")
    .addColumn("photo_mime", "text")
    .addColumn("status", sql`public.curtain_type_status`, (c) =>
      c.notNull().defaultTo(sql`'Active'::public.curtain_type_status`),
    )
    .addColumn("created_by", "uuid", (c) => c.references("profiles.id"))
    .addColumn("created_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .addColumn("updated_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .execute();

  // Reuse the shared set_updated_at fn created by the initial migration.
  await sql`
    create trigger curtain_types_set_updated_at
      before update on public.curtain_types
      for each row execute function public.set_updated_at()
  `.execute(db);

  await db.schema
    .createIndex("curtain_types_status_idx")
    .on("curtain_types")
    .column("status")
    .execute();
  await db.schema
    .createIndex("curtain_types_category_idx")
    .on("curtain_types")
    .column("category")
    .execute();

  // RLS — mirror fabrics: authenticated read, admin write, no delete policy
  // (soft-delete via status).
  await sql`alter table public.curtain_types enable row level security`.execute(
    db,
  );
  await sql`
    create policy "curtain_types_select_authenticated"
      on public.curtain_types for select to authenticated using (true)
  `.execute(db);
  await sql`
    create policy "curtain_types_insert_admin"
      on public.curtain_types for insert to authenticated
      with check (public.is_admin())
  `.execute(db);
  await sql`
    create policy "curtain_types_update_admin"
      on public.curtain_types for update to authenticated
      using (public.is_admin()) with check (public.is_admin())
  `.execute(db);

  // ── windows: additive nullable curtain-type FKs ───────────────────────
  await db.schema
    .alterTable("windows")
    .addColumn("day_curtain_type_id", "uuid", (c) =>
      c.references("curtain_types.id"),
    )
    .addColumn("night_curtain_type_id", "uuid", (c) =>
      c.references("curtain_types.id"),
    )
    .addColumn("curtain_type_id", "uuid", (c) =>
      c.references("curtain_types.id"),
    )
    .execute();

  // Extend the shape guard so the type-id columns follow the same rule as the
  // fabric-code columns: toilet windows carry a single curtain_type_id;
  // regular windows carry day/night type ids.
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

  // ── storage bucket + policies (path: curtain-types/<id>/<file>) ────────
  await sql`
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values (
      'curtain-type-photos', 'curtain-type-photos', false,
      ${10 * 1024 * 1024},
      array['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
    )
    on conflict (id) do update set
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types,
      public = excluded.public
  `.execute(db);

  await sql`
    create policy "curtain_type_photos_storage_select_authenticated"
      on storage.objects for select to authenticated
      using (bucket_id = 'curtain-type-photos')
  `.execute(db);
  await sql`
    create policy "curtain_type_photos_storage_insert_admin"
      on storage.objects for insert to authenticated
      with check (bucket_id = 'curtain-type-photos' and public.is_admin())
  `.execute(db);
  await sql`
    create policy "curtain_type_photos_storage_update_admin"
      on storage.objects for update to authenticated
      using (bucket_id = 'curtain-type-photos' and public.is_admin())
  `.execute(db);
  await sql`
    create policy "curtain_type_photos_storage_delete_admin"
      on storage.objects for delete to authenticated
      using (bucket_id = 'curtain-type-photos' and public.is_admin())
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Storage policies + bucket.
  await sql`drop policy if exists "curtain_type_photos_storage_delete_admin" on storage.objects`.execute(
    db,
  );
  await sql`drop policy if exists "curtain_type_photos_storage_update_admin" on storage.objects`.execute(
    db,
  );
  await sql`drop policy if exists "curtain_type_photos_storage_insert_admin" on storage.objects`.execute(
    db,
  );
  await sql`drop policy if exists "curtain_type_photos_storage_select_authenticated" on storage.objects`.execute(
    db,
  );
  await sql`delete from storage.objects where bucket_id = 'curtain-type-photos'`.execute(
    db,
  );
  await sql`delete from storage.buckets where id = 'curtain-type-photos'`.execute(
    db,
  );

  // Restore the original (pre-Phase-8) window-shape guard.
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
        if new.day_curtain_code is not null or new.night_curtain_code is not null or new.draw is not null then
          raise exception 'toilet windows must not have day_curtain_code/night_curtain_code/draw';
        end if;
      else
        if new.curtain_code is not null then
          raise exception 'non-toilet windows must not have curtain_code (use day/night)';
        end if;
      end if;
      return new;
    end
    $$
  `.execute(db);

  // Window FK columns.
  await db.schema.alterTable("windows").dropColumn("curtain_type_id").execute();
  await db.schema
    .alterTable("windows")
    .dropColumn("night_curtain_type_id")
    .execute();
  await db.schema
    .alterTable("windows")
    .dropColumn("day_curtain_type_id")
    .execute();

  // Table (drops its trigger + indexes with it), then enums.
  await db.schema.dropTable("curtain_types").execute();
  await sql`drop type public.curtain_type_status`.execute(db);
  await sql`drop type public.curtain_category`.execute(db);
}
