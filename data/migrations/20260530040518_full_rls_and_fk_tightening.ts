import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  // ── fabrics ───────────────────────────────────────────────────────────
  await sql`
    create policy "fabrics_select_authenticated"
      on public.fabrics for select to authenticated
      using (true)
  `.execute(db);
  await sql`
    create policy "fabrics_insert_admin"
      on public.fabrics for insert to authenticated
      with check (public.is_admin())
  `.execute(db);
  await sql`
    create policy "fabrics_update_admin"
      on public.fabrics for update to authenticated
      using (public.is_admin())
      with check (public.is_admin())
  `.execute(db);

  // ── customers ─────────────────────────────────────────────────────────
  await sql`
    create policy "customers_select_authenticated"
      on public.customers for select to authenticated
      using (true)
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

  // ── orders ────────────────────────────────────────────────────────────
  await sql`
    create policy "orders_select_authenticated"
      on public.orders for select to authenticated
      using (true)
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

  // ── rooms (parent-gated by orders ownership) ─────────────────────────
  await sql`
    create policy "rooms_select_authenticated"
      on public.rooms for select to authenticated
      using (true)
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

  // ── windows (parent-gated via rooms → orders) ────────────────────────
  await sql`
    create policy "windows_select_authenticated"
      on public.windows for select to authenticated
      using (true)
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

  // ── order_status_events ──────────────────────────────────────────────
  await sql`
    create policy "ose_select_authenticated"
      on public.order_status_events for select to authenticated
      using (true)
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

  // ── room_photos (parent-gated via rooms → orders) ────────────────────
  await sql`
    create policy "room_photos_select_authenticated"
      on public.room_photos for select to authenticated
      using (true)
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

  // ── Storage policies on the room-photos bucket ───────────────────────
  // Path convention: orders/<order_id>/rooms/<room_id>/<filename>
  // storage.foldername returns ['orders','<order_id>','rooms','<room_id>'],
  // so index 4 is the room_id.
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

  // ── Tighten FKs to profiles(id) — nullable so existing rows survive ──
  await sql`
    alter table public.customers
      add constraint customers_created_by_fkey
      foreign key (created_by) references public.profiles(id)
  `.execute(db);
  await sql`
    alter table public.fabrics
      add constraint fabrics_created_by_fkey
      foreign key (created_by) references public.profiles(id)
  `.execute(db);
  await sql`
    alter table public.orders
      add constraint orders_consultant_id_fkey
      foreign key (consultant_id) references public.profiles(id)
  `.execute(db);
  await sql`
    alter table public.order_status_events
      add constraint order_status_events_created_by_fkey
      foreign key (created_by) references public.profiles(id)
  `.execute(db);
  await sql`
    alter table public.room_photos
      add constraint room_photos_uploaded_by_fkey
      foreign key (uploaded_by) references public.profiles(id)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`alter table public.room_photos drop constraint if exists room_photos_uploaded_by_fkey`.execute(db);
  await sql`alter table public.order_status_events drop constraint if exists order_status_events_created_by_fkey`.execute(db);
  await sql`alter table public.orders drop constraint if exists orders_consultant_id_fkey`.execute(db);
  await sql`alter table public.fabrics drop constraint if exists fabrics_created_by_fkey`.execute(db);
  await sql`alter table public.customers drop constraint if exists customers_created_by_fkey`.execute(db);

  for (const p of [
    "room_photos_storage_delete_owner_admin",
    "room_photos_storage_update_owner_admin",
    "room_photos_storage_insert_owner_admin",
    "room_photos_storage_select_authenticated",
  ]) {
    await sql`drop policy if exists ${sql.lit(p)} on storage.objects`.execute(db);
  }

  for (const p of [
    "room_photos_write_owner_admin",
    "room_photos_select_authenticated",
  ]) {
    await sql`drop policy if exists ${sql.lit(p)} on public.room_photos`.execute(db);
  }
  await sql`drop policy if exists "ose_insert_advance_or_note" on public.order_status_events`.execute(db);
  await sql`drop policy if exists "ose_select_authenticated" on public.order_status_events`.execute(db);
  for (const p of ["windows_write_owner_admin", "windows_select_authenticated"]) {
    await sql`drop policy if exists ${sql.lit(p)} on public.windows`.execute(db);
  }
  for (const p of ["rooms_write_owner_admin", "rooms_select_authenticated"]) {
    await sql`drop policy if exists ${sql.lit(p)} on public.rooms`.execute(db);
  }
  for (const p of [
    "orders_update_owner_admin",
    "orders_insert_consultant_admin",
    "orders_select_authenticated",
  ]) {
    await sql`drop policy if exists ${sql.lit(p)} on public.orders`.execute(db);
  }
  for (const p of [
    "customers_delete_admin",
    "customers_update_consultant_admin",
    "customers_insert_consultant_admin",
    "customers_select_authenticated",
  ]) {
    await sql`drop policy if exists ${sql.lit(p)} on public.customers`.execute(db);
  }
  for (const p of [
    "fabrics_update_admin",
    "fabrics_insert_admin",
    "fabrics_select_authenticated",
  ]) {
    await sql`drop policy if exists ${sql.lit(p)} on public.fabrics`.execute(db);
  }
}
