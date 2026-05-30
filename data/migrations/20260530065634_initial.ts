import { sql, type Kysely } from "kysely";

// Consolidated initial migration. Replaces the 12 incremental migrations
// shipped during Phases 1–7 + auth retrofit + the review fixes. Schema is
// the same final state, minus the seed_fabrics insert (intentionally
// dropped — fabrics table starts empty so the user can populate their own
// catalog).

export async function up(db: Kysely<unknown>): Promise<void> {
  // ── extensions ────────────────────────────────────────────────────────
  await sql`create extension if not exists "pgcrypto"`.execute(db);
  await sql`create extension if not exists pg_trgm`.execute(db);

  // ── enums ─────────────────────────────────────────────────────────────
  await sql`create type public.user_role as enum ('consultant', 'ops', 'admin')`.execute(db);
  await sql`create type public.fabric_type as enum ('Day', 'Night', 'Both')`.execute(db);
  await sql`create type public.fabric_status as enum ('Active', 'Discontinued')`.execute(db);
  await sql`create type public.property_type as enum ('HDB', 'Condo', 'Landed', 'Commercial')`.execute(db);
  await sql`
    create type public.room_type as enum (
      'Living Room', 'Master Bedroom', 'Bedroom',
      'Master Toilet', 'Common Toilet',
      'Kitchen', 'Study Room', 'Balcony', 'Other'
    )
  `.execute(db);
  await sql`create type public.draw_direction as enum ('Double', 'Single Left', 'Single Right')`.execute(db);
  await sql`
    create type public.fulfilment_status as enum (
      'order_made', 'sent_logistic', 'shipping_sg',
      'delivered_checked', 'fulfilment', 'completed'
    )
  `.execute(db);

  // ── shared updated_at trigger function ────────────────────────────────
  await sql`
    create or replace function public.set_updated_at() returns trigger
    language plpgsql as $$
    begin
      new.updated_at = now();
      return new;
    end
    $$
  `.execute(db);

  // ── profiles table + auto-insert on auth user creation ───────────────
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

  // ── role helpers ──────────────────────────────────────────────────────
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

  // ── profiles RLS + role guard ────────────────────────────────────────
  await sql`alter table public.profiles enable row level security`.execute(db);

  await sql`
    create policy "profiles_select_authenticated"
      on public.profiles for select to authenticated using (true)
  `.execute(db);
  await sql`
    create policy "profiles_update_own"
      on public.profiles for update to authenticated
      using (id = auth.uid()) with check (id = auth.uid())
  `.execute(db);
  await sql`
    create policy "profiles_update_admin"
      on public.profiles for update to authenticated
      using (public.is_admin()) with check (public.is_admin())
  `.execute(db);
  await sql`
    create policy "profiles_delete_admin"
      on public.profiles for delete to authenticated
      using (public.is_admin())
  `.execute(db);

  // Role mutation guard. The current_user bypass lets the postgres pooler
  // role and the service_role JWT change profile.role without a real
  // session — needed so server actions (Kysely-as-postgres) can mutate
  // roles, while still blocking browser-side anon/authenticated callers
  // who aren't admin.
  await sql`
    create or replace function public.guard_profile_role_update() returns trigger
    language plpgsql security definer set search_path = public as $$
    begin
      if (new.role is distinct from old.role)
         and not public.is_admin()
         and current_user not in ('postgres', 'service_role') then
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

  // ── fabrics ───────────────────────────────────────────────────────────
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
    .addColumn("created_by", "uuid", (col) =>
      col.references("profiles.id"),
    )
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

  // ── customers ─────────────────────────────────────────────────────────
  await db.schema
    .createTable("customers")
    .addColumn("id", "uuid", (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("name", "text", (col) => col.notNull())
    .addColumn("mobile", "text", (col) => col.notNull())
    .addColumn("email", "text")
    .addColumn("created_by", "uuid", (col) =>
      col.references("profiles.id"),
    )
    .addColumn("created_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn("updated_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await sql`
    create trigger customers_set_updated_at
      before update on public.customers
      for each row execute function public.set_updated_at()
  `.execute(db);

  await db.schema
    .createIndex("customers_mobile_idx")
    .on("customers")
    .column("mobile")
    .execute();
  await sql`create index customers_mobile_trgm on public.customers using gin (mobile gin_trgm_ops)`.execute(db);
  await sql`create index customers_name_trgm on public.customers using gin (name gin_trgm_ops)`.execute(db);

  await sql`alter table public.customers enable row level security`.execute(db);
  await sql`
    create policy "customers_select_authenticated"
      on public.customers for select to authenticated using (true)
  `.execute(db);
  await sql`
    create policy "customers_insert_consultant_admin"
      on public.customers for insert to authenticated
      with check (public.is_consultant() or public.is_admin())
  `.execute(db);
  await sql`
    create policy "customers_update_consultant_admin"
      on public.customers for update to authenticated
      using (public.is_consultant() or public.is_admin())
      with check (public.is_consultant() or public.is_admin())
  `.execute(db);
  await sql`
    create policy "customers_delete_admin"
      on public.customers for delete to authenticated
      using (public.is_admin())
  `.execute(db);

  // ── order_year_counters (used by display_id trigger) ─────────────────
  await db.schema
    .createTable("order_year_counters")
    .addColumn("year", "integer", (col) => col.primaryKey())
    .addColumn("last_seq", "integer", (col) => col.notNull().defaultTo(0))
    .execute();
  await sql`alter table public.order_year_counters enable row level security`.execute(db);

  // ── orders ────────────────────────────────────────────────────────────
  await db.schema
    .createTable("orders")
    .addColumn("id", "uuid", (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("display_id", "text", (col) => col.notNull().unique())
    .addColumn("seq_year", "integer", (col) => col.notNull())
    .addColumn("seq_num", "integer", (col) => col.notNull())
    .addColumn("customer_id", "uuid", (col) =>
      col.notNull().references("customers.id").onDelete("restrict"),
    )
    .addColumn("consultant_id", "uuid", (col) =>
      col.references("profiles.id"),
    )
    .addColumn("property_type", sql`public.property_type`)
    .addColumn("development", "text")
    .addColumn("unit_type", "text")
    .addColumn("move_in_date", "date")
    .addColumn("price_quoted_cents", "integer", (col) =>
      col.notNull().defaultTo(0),
    )
    .addColumn("deposit_cents", "integer", (col) =>
      col.notNull().defaultTo(0),
    )
    .addColumn(
      "balance_cents",
      "integer",
      (col) =>
        col.generatedAlwaysAs(
          sql`greatest(price_quoted_cents - deposit_cents, 0)`,
        ).stored(),
    )
    .addColumn("current_status", sql`public.fulfilment_status`, (col) =>
      col.notNull().defaultTo(sql`'order_made'::public.fulfilment_status`),
    )
    .addColumn("general_notes", "text")
    .addColumn("is_draft", "boolean", (col) => col.notNull().defaultTo(false))
    .addColumn("created_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn("updated_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await sql`
    create trigger orders_set_updated_at
      before update on public.orders
      for each row execute function public.set_updated_at()
  `.execute(db);

  await db.schema
    .createIndex("orders_current_status_idx")
    .on("orders")
    .column("current_status")
    .execute();
  await db.schema
    .createIndex("orders_consultant_idx")
    .on("orders")
    .column("consultant_id")
    .execute();
  await db.schema
    .createIndex("orders_move_in_idx")
    .on("orders")
    .column("move_in_date")
    .execute();
  await sql`create index orders_created_at_idx on public.orders (created_at desc)`.execute(db);
  await sql`create index orders_development_trgm on public.orders using gin (development gin_trgm_ops)`.execute(db);

  // display_id assignment trigger
  await sql`
    create or replace function public.assign_order_display_id() returns trigger
    language plpgsql as $$
    declare
      v_year int := extract(year from now())::int;
      v_seq int;
    begin
      insert into public.order_year_counters (year, last_seq) values (v_year, 0)
        on conflict (year) do nothing;
      update public.order_year_counters
        set last_seq = last_seq + 1
        where year = v_year
        returning last_seq into v_seq;
      new.seq_year := v_year;
      new.seq_num := v_seq;
      new.display_id := 'DW-' || v_year || '-' || lpad(v_seq::text, 4, '0');
      return new;
    end
    $$
  `.execute(db);

  await sql`
    create trigger orders_assign_display_id
      before insert on public.orders
      for each row execute function public.assign_order_display_id()
  `.execute(db);

  await sql`alter table public.orders enable row level security`.execute(db);
  await sql`
    create policy "orders_select_authenticated"
      on public.orders for select to authenticated using (true)
  `.execute(db);
  await sql`
    create policy "orders_insert_consultant_admin"
      on public.orders for insert to authenticated
      with check (
        (public.is_consultant() or public.is_admin())
        and (consultant_id = auth.uid() or public.is_admin())
      )
  `.execute(db);
  await sql`
    create policy "orders_update_owner_admin"
      on public.orders for update to authenticated
      using (consultant_id = auth.uid() or public.is_admin())
      with check (consultant_id = auth.uid() or public.is_admin())
  `.execute(db);

  // ── rooms ─────────────────────────────────────────────────────────────
  await db.schema
    .createTable("rooms")
    .addColumn("id", "uuid", (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("order_id", "uuid", (col) =>
      col.notNull().references("orders.id").onDelete("cascade"),
    )
    .addColumn("type", sql`public.room_type`, (col) => col.notNull())
    .addColumn("label", "text", (col) => col.notNull())
    .addColumn("position", "integer", (col) => col.notNull())
    .addColumn("created_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createIndex("rooms_order_idx")
    .on("rooms")
    .columns(["order_id", "position"])
    .execute();

  await sql`alter table public.rooms enable row level security`.execute(db);
  await sql`
    create policy "rooms_select_authenticated"
      on public.rooms for select to authenticated using (true)
  `.execute(db);
  await sql`
    create policy "rooms_write_owner_admin"
      on public.rooms for all to authenticated
      using (
        exists (
          select 1 from public.orders o
          where o.id = rooms.order_id
            and (o.consultant_id = auth.uid() or public.is_admin())
        )
      )
      with check (
        exists (
          select 1 from public.orders o
          where o.id = rooms.order_id
            and (o.consultant_id = auth.uid() or public.is_admin())
        )
      )
  `.execute(db);

  // ── windows + shape validator ────────────────────────────────────────
  await db.schema
    .createTable("windows")
    .addColumn("id", "uuid", (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("room_id", "uuid", (col) =>
      col.notNull().references("rooms.id").onDelete("cascade"),
    )
    .addColumn("position", "integer", (col) => col.notNull())
    .addColumn("width_cm", "integer")
    .addColumn("height_cm", "integer")
    .addColumn("install_width_cm", "integer")
    .addColumn("notes", "text")
    .addColumn("curtain_code", "text", (col) =>
      col.references("fabrics.code"),
    )
    .addColumn("day_curtain_code", "text", (col) =>
      col.references("fabrics.code"),
    )
    .addColumn("night_curtain_code", "text", (col) =>
      col.references("fabrics.code"),
    )
    .addColumn("draw", sql`public.draw_direction`)
    .addColumn("created_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createIndex("windows_room_idx")
    .on("windows")
    .columns(["room_id", "position"])
    .execute();

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

  await sql`
    create trigger windows_validate_shape
      before insert or update on public.windows
      for each row execute function public.validate_window_shape()
  `.execute(db);

  await sql`alter table public.windows enable row level security`.execute(db);
  await sql`
    create policy "windows_select_authenticated"
      on public.windows for select to authenticated using (true)
  `.execute(db);
  await sql`
    create policy "windows_write_owner_admin"
      on public.windows for all to authenticated
      using (
        exists (
          select 1 from public.rooms r
            join public.orders o on o.id = r.order_id
          where r.id = windows.room_id
            and (o.consultant_id = auth.uid() or public.is_admin())
        )
      )
      with check (
        exists (
          select 1 from public.rooms r
            join public.orders o on o.id = r.order_id
          where r.id = windows.room_id
            and (o.consultant_id = auth.uid() or public.is_admin())
        )
      )
  `.execute(db);

  // ── order_status_events + sync trigger + transition validator ─────────
  await db.schema
    .createTable("order_status_events")
    .addColumn("id", "uuid", (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("order_id", "uuid", (col) =>
      col.notNull().references("orders.id").onDelete("cascade"),
    )
    .addColumn("status", sql`public.fulfilment_status`, (col) => col.notNull())
    .addColumn("note", "text")
    .addColumn("created_by", "uuid", (col) =>
      col.references("profiles.id"),
    )
    .addColumn("created_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await sql`
    create index order_status_events_order_idx
      on public.order_status_events (order_id, created_at desc)
  `.execute(db);

  await sql`
    create or replace function public.sync_order_current_status() returns trigger
    language plpgsql as $$
    begin
      update public.orders
        set current_status = new.status, updated_at = now()
        where id = new.order_id;
      return new;
    end
    $$
  `.execute(db);

  await sql`
    create trigger order_status_events_sync
      after insert on public.order_status_events
      for each row execute function public.sync_order_current_status()
  `.execute(db);

  // Linear status flow: allow same-status notes, +1 advance, -1 revert.
  // (The action layer gates -1 on admin role.)
  await sql`
    create or replace function public.validate_status_transition() returns trigger
    language plpgsql as $$
    declare
      v_current public.fulfilment_status;
      v_flow text[] := array['order_made','sent_logistic','shipping_sg','delivered_checked','fulfilment','completed'];
      v_current_idx int;
      v_new_idx int;
    begin
      select current_status into v_current from public.orders where id = new.order_id;
      v_current_idx := array_position(v_flow, v_current::text);
      v_new_idx := array_position(v_flow, new.status::text);

      if v_new_idx is null then
        raise exception 'unknown status';
      end if;

      if v_new_idx = v_current_idx then return new; end if;
      if v_new_idx = v_current_idx + 1 then return new; end if;
      if v_new_idx = v_current_idx - 1 then return new; end if;

      raise exception 'invalid status transition: % -> %', v_current, new.status;
    end
    $$
  `.execute(db);

  await sql`
    create trigger ose_validate_transition
      before insert on public.order_status_events
      for each row execute function public.validate_status_transition()
  `.execute(db);

  await sql`alter table public.order_status_events enable row level security`.execute(db);
  await sql`
    create policy "ose_select_authenticated"
      on public.order_status_events for select to authenticated using (true)
  `.execute(db);
  await sql`
    create policy "ose_insert_advance_or_note" on public.order_status_events
      for insert to authenticated
      with check (
        public.is_ops()
        or public.is_admin()
        or (
          public.is_consultant()
          and exists (
            select 1 from public.orders o
            where o.id = order_status_events.order_id
              and o.consultant_id = auth.uid()
              and o.current_status = order_status_events.status
          )
          and order_status_events.note is not null
          and length(order_status_events.note) > 0
        )
      )
  `.execute(db);

  // ── room_photos ───────────────────────────────────────────────────────
  await db.schema
    .createTable("room_photos")
    .addColumn("id", "uuid", (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("room_id", "uuid", (col) =>
      col.notNull().references("rooms.id").onDelete("cascade"),
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
    .createIndex("room_photos_room_idx")
    .on("room_photos")
    .columns(["room_id", "position", "created_at"])
    .execute();

  await sql`alter table public.room_photos enable row level security`.execute(db);
  await sql`
    create policy "room_photos_select_authenticated"
      on public.room_photos for select to authenticated using (true)
  `.execute(db);
  await sql`
    create policy "room_photos_write_owner_admin"
      on public.room_photos for all to authenticated
      using (
        exists (
          select 1 from public.rooms r
            join public.orders o on o.id = r.order_id
          where r.id = room_photos.room_id
            and (o.consultant_id = auth.uid() or public.is_admin())
        )
      )
      with check (
        exists (
          select 1 from public.rooms r
            join public.orders o on o.id = r.order_id
          where r.id = room_photos.room_id
            and (o.consultant_id = auth.uid() or public.is_admin())
        )
      )
  `.execute(db);

  // ── storage bucket + policies (path: orders/<order>/rooms/<room>/<f>) ─
  await sql`
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values (
      'room-photos', 'room-photos', false,
      ${10 * 1024 * 1024},
      array['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
    )
    on conflict (id) do update set
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types,
      public = excluded.public
  `.execute(db);

  await sql`
    create policy "room_photos_storage_select_authenticated"
      on storage.objects for select to authenticated
      using (bucket_id = 'room-photos')
  `.execute(db);
  await sql`
    create policy "room_photos_storage_insert_owner_admin"
      on storage.objects for insert to authenticated
      with check (
        bucket_id = 'room-photos'
        and (
          public.is_admin()
          or exists (
            select 1 from public.rooms r
              join public.orders o on o.id = r.order_id
            where r.id = ((storage.foldername(name))[4])::uuid
              and o.consultant_id = auth.uid()
          )
        )
      )
  `.execute(db);
  await sql`
    create policy "room_photos_storage_update_owner_admin"
      on storage.objects for update to authenticated
      using (
        bucket_id = 'room-photos'
        and (
          public.is_admin()
          or exists (
            select 1 from public.rooms r
              join public.orders o on o.id = r.order_id
            where r.id = ((storage.foldername(name))[4])::uuid
              and o.consultant_id = auth.uid()
          )
        )
      )
  `.execute(db);
  await sql`
    create policy "room_photos_storage_delete_owner_admin"
      on storage.objects for delete to authenticated
      using (
        bucket_id = 'room-photos'
        and (
          public.is_admin()
          or exists (
            select 1 from public.rooms r
              join public.orders o on o.id = r.order_id
            where r.id = ((storage.foldername(name))[4])::uuid
              and o.consultant_id = auth.uid()
          )
        )
      )
  `.execute(db);

  // ── backfill profiles from any existing auth.users ───────────────────
  // The on_auth_user_created trigger only fires on new inserts; users who
  // already exist in auth need a one-shot backfill.
  await sql`
    insert into public.profiles (id, email, full_name)
    select id, email,
      coalesce(raw_user_meta_data->>'full_name', split_part(email, '@', 1))
    from auth.users
    on conflict (id) do nothing
  `.execute(db);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function down(_db: Kysely<unknown>): Promise<void> {
  // The full rollback path is `drop schema public cascade` + delete the
  // storage bucket via the Supabase Storage API. Not expressible as a
  // single Kysely script — see scripts/reset_db.ts for the procedure.
  throw new Error(
    "down migration not supported; reset the database manually",
  );
}
