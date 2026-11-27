import { sql, type Kysely } from "kysely";

// Order-window flow additions:
//  - windows.label: an editable per-window location label. Null keeps the
//    legacy "Window N" wording everywhere downstream.
//  - windows.track_only / windows.track_kind: a window that supplies and
//    installs a rail WITHOUT a covering. Validated by the same
//    validate_window_shape() trigger that guards the curtain/blind split.
//  - customers.salutation: optional title (Mr/Mrs/Ms/Dr or a custom string),
//    capped at Zoho Books' 25-character salutation limit so a stored value is
//    always pushable.
//  - window_photos: per-window detail photos, mirroring room_photos exactly —
//    same private-bucket, owner-or-admin safeguards, one level down.
//  - customer_zoho_links.pending_salutation / salutation_sync_error: the CRM
//    save never depends on the Zoho contact-person update landing. A failure
//    parks the desired salutation here so the UI can show a pending state and
//    offer a retry, instead of silently dropping it.

export async function up(db: Kysely<unknown>): Promise<void> {
  // ── windows: label + track-only ───────────────────────────────────────
  await db.schema
    .alterTable("windows")
    .addColumn("label", "text")
    .addColumn("track_only", "boolean", (col) => col.notNull().defaultTo(false))
    .addColumn("track_kind", "text", (col) =>
      col.check(sql`track_kind in ('single', 'double')`),
    )
    .execute();

  // A track-only window carries no covering: just a rail over the opening.
  // Same invariant style as the blind branch above — enforced structurally by
  // windowValues() nulled columns AND independently here.
  await sql`
    create or replace function public.validate_window_shape() returns trigger
    language plpgsql as $$
    declare
      v_room_type public.room_type;
    begin
      if new.track_only then
        if new.track_kind is null then
          raise exception 'track-only windows need a track kind (single or double)';
        end if;
        if new.blind_type_id is not null
           or new.day_curtain_type_id is not null
           or new.night_curtain_type_id is not null
           or new.combo_id is not null
           or new.draw is not null
           or new.split_left_cm is not null
           or new.split_right_cm is not null then
          raise exception 'track-only windows must not carry a covering or draw';
        end if;
        -- Installation is the ONLY thing a track-only window bills.
        if new.no_installation then
          raise exception 'track-only windows are installation-only';
        end if;
        select type into v_room_type from public.rooms where id = new.room_id;
        if v_room_type in ('Master Toilet', 'Common Toilet') then
          raise exception 'toilet windows take a blind, not a track';
        end if;
        return new;
      end if;

      if new.track_kind is not null then
        raise exception 'track kind is only for track-only windows';
      end if;

      -- A blind carries no curtain. Valid in every room, toilets included.
      if new.blind_type_id is not null then
        if new.day_curtain_type_id is not null
           or new.night_curtain_type_id is not null then
          raise exception 'blind windows must not have a curtain type';
        end if;
        return new;
      end if;

      -- No blind picked: a curtain window, or an empty one being filled in.
      -- Note draw is now permitted here: on a half-filled toilet window it is
      -- the blind's control side, and a draft must survive the round trip.
      select type into v_room_type from public.rooms where id = new.room_id;
      if v_room_type in ('Master Toilet', 'Common Toilet')
         and (new.day_curtain_type_id is not null
              or new.night_curtain_type_id is not null) then
        raise exception 'toilet windows take a blind, not a curtain';
      end if;
      return new;
    end
    $$
  `.execute(db);

  // ── customers: salutation ─────────────────────────────────────────────
  await db.schema
    .alterTable("customers")
    .addColumn("salutation", "text", (col) =>
      col.check(sql`salutation is null or char_length(salutation) <= 25`),
    )
    .execute();

  // ── customer_zoho_links: pending salutation push ──────────────────────
  await db.schema
    .alterTable("customer_zoho_links")
    .addColumn("pending_salutation", "text")
    .addColumn("salutation_sync_error", "text")
    .execute();

  // ── window_photos ─────────────────────────────────────────────────────
  await db.schema
    .createTable("window_photos")
    .addColumn("id", "uuid", (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("window_id", "uuid", (col) =>
      col.notNull().references("windows.id").onDelete("cascade"),
    )
    .addColumn("storage_path", "text", (col) => col.notNull().unique())
    .addColumn("mime_type", "text", (col) => col.notNull())
    .addColumn("size_bytes", "integer", (col) => col.notNull())
    .addColumn("original_name", "text")
    .addColumn("uploaded_by", "uuid", (col) =>
      col.references("profiles.id"),
    )
    .addColumn("position", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("created_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createIndex("window_photos_window_idx")
    .on("window_photos")
    .columns(["window_id", "position", "created_at"])
    .execute();

  await sql`alter table public.window_photos enable row level security`.execute(db);
  await sql`
    create policy "window_photos_select_authenticated"
      on public.window_photos for select to authenticated using (true)
  `.execute(db);
  await sql`
    create policy "window_photos_write_owner_admin"
      on public.window_photos for all to authenticated
      using (
        exists (
          select 1 from public.windows w
            join public.rooms r on r.id = w.room_id
            join public.orders o on o.id = r.order_id
          where w.id = window_photos.window_id
            and (o.consultant_id = auth.uid() or public.is_admin())
        )
      )
      with check (
        exists (
          select 1 from public.windows w
            join public.rooms r on r.id = w.room_id
            join public.orders o on o.id = r.order_id
          where w.id = window_photos.window_id
            and (o.consultant_id = auth.uid() or public.is_admin())
        )
      )
  `.execute(db);

  // ── storage bucket + policies (path: orders/<o>/windows/<w>/<f>) ──────
  await sql`
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values (
      'window-photos', 'window-photos', false,
      ${10 * 1024 * 1024},
      array['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
    )
    on conflict (id) do update set
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types,
      public = excluded.public
  `.execute(db);

  await sql`
    create policy "window_photos_storage_select_authenticated"
      on storage.objects for select to authenticated
      using (bucket_id = 'window-photos')
  `.execute(db);
  await sql`
    create policy "window_photos_storage_insert_owner_admin"
      on storage.objects for insert to authenticated
      with check (
        bucket_id = 'window-photos'
        and (
          public.is_admin()
          or exists (
            select 1 from public.windows w
              join public.rooms r on r.id = w.room_id
              join public.orders o on o.id = r.order_id
            where w.id = ((storage.foldername(name))[4])::uuid
              and o.consultant_id = auth.uid()
          )
        )
      )
  `.execute(db);
  await sql`
    create policy "window_photos_storage_update_owner_admin"
      on storage.objects for update to authenticated
      using (
        bucket_id = 'window-photos'
        and (
          public.is_admin()
          or exists (
            select 1 from public.windows w
              join public.rooms r on r.id = w.room_id
              join public.orders o on o.id = r.order_id
            where w.id = ((storage.foldername(name))[4])::uuid
              and o.consultant_id = auth.uid()
          )
        )
      )
  `.execute(db);
  await sql`
    create policy "window_photos_storage_delete_owner_admin"
      on storage.objects for delete to authenticated
      using (
        bucket_id = 'window-photos'
        and (
          public.is_admin()
          or exists (
            select 1 from public.windows w
              join public.rooms r on r.id = w.room_id
              join public.orders o on o.id = r.order_id
            where w.id = ((storage.foldername(name))[4])::uuid
              and o.consultant_id = auth.uid()
          )
        )
      )
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    drop policy if exists "window_photos_storage_delete_owner_admin" on storage.objects;
    drop policy if exists "window_photos_storage_update_owner_admin" on storage.objects;
    drop policy if exists "window_photos_storage_insert_owner_admin" on storage.objects;
    drop policy if exists "window_photos_storage_select_authenticated" on storage.objects;
    delete from storage.buckets where id = 'window-photos';
  `.execute(db);

  await db.schema.dropTable("window_photos").execute();

  await db.schema
    .alterTable("customer_zoho_links")
    .dropColumn("pending_salutation")
    .dropColumn("salutation_sync_error")
    .execute();

  await db.schema.alterTable("customers").dropColumn("salutation").execute();

  await db.schema
    .alterTable("windows")
    .dropColumn("label")
    .dropColumn("track_only")
    .dropColumn("track_kind")
    .execute();

  // Restore the body 202608212200 left in place.
  await sql`
    create or replace function public.validate_window_shape() returns trigger
    language plpgsql as $$
    declare
      v_room_type public.room_type;
    begin
      if new.blind_type_id is not null then
        if new.day_curtain_type_id is not null
           or new.night_curtain_type_id is not null then
          raise exception 'blind windows must not have a curtain type';
        end if;
        return new;
      end if;

      select type into v_room_type from public.rooms where id = new.room_id;
      if v_room_type in ('Master Toilet', 'Common Toilet')
         and (new.day_curtain_type_id is not null
              or new.night_curtain_type_id is not null) then
        raise exception 'toilet windows take a blind, not a curtain';
      end if;
      return new;
    end
    $$
  `.execute(db);
}
