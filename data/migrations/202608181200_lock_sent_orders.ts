import { sql, type Kysely } from "kysely";

// Phase 13B — the sent-to-vendor lock, enforced by the database rather than
// only by the Server Actions.
//
// Once an order reaches `sent_to_vendor` the manufacturing dimensions have been
// frozen and handed over: the goods are being cut. Editing the consultation
// behind that is how a customer ends up with curtains sized for a different
// window. The action layer refuses those edits (see isLocked in
// src/lib/status-flow.ts); this migration is the guarantee that survives a bug
// in an action, a new code path, or a direct PostgREST call.
//
// WHAT STAYS EDITABLE ON A LOCKED ORDER, and why the lock is shaped the way it
// is:
//
//   * `orders.current_status` — an order MUST still be able to advance from
//     sent_to_vendor all the way to completed. Status advancement happens by
//     inserting into order_status_events, whose AFTER INSERT trigger
//     (sync_order_current_status) UPDATEs orders.current_status. That trigger
//     function is not SECURITY DEFINER, so it runs as the caller and is subject
//     to the caller's RLS. A blanket `not order_is_locked(id)` predicate on
//     orders_update_owner_admin would therefore make the trigger's UPDATE match
//     zero rows — SILENTLY, because a row filtered out by an UPDATE policy's
//     USING clause is not an error — and every order would strand at
//     sent_to_vendor forever. Verified empirically before this migration was
//     written.
//   * `orders.order_reference` — paperwork, not a manufacturing input. A vendor
//     may ask for a renumber mid-production. setOrderReference is deliberately
//     not status-gated.
//   * `orders.updated_at` — written by the orders_set_updated_at trigger.
//
// So the orders half of the lock CANNOT be a row-level policy: RLS has no
// access to the old row alongside the new one, and therefore cannot say "these
// columns may change and those may not". `orders_update_owner_admin` is left
// exactly as it was, and the column freeze is done by a BEFORE UPDATE trigger,
// which is the only mechanism in Postgres that can compare OLD to NEW. As a
// bonus the trigger also binds the application's own pooled connection, which
// owns these tables and so bypasses RLS entirely.
//
// rooms, windows and mesh_panels have no such exception — every column on them
// is a manufacturing input — so those three get the blanket RLS predicate.

const LOCKED_STATUSES = `'sent_to_vendor','sent_logistic','shipping_sg',
                               'delivered_checked','fulfilment','completed'`;

// Columns an order may still change once it is locked. Everything else is
// frozen. Written as an allow-list so a column added later is frozen by
// default — the safe direction to fail.
const MUTABLE_WHILE_LOCKED = `array['current_status','updated_at','order_reference']::text[]`;

export async function up(db: Kysely<unknown>): Promise<void> {
  // SECURITY DEFINER so the policies below can consult orders without the
  // caller needing to see the row, and so a policy on orders' own children
  // cannot recurse into orders' policies.
  await sql`
    create or replace function public.order_is_locked(p_order_id uuid) returns boolean
    language sql stable security definer set search_path = public as $$
      select exists (
        select 1 from public.orders o
        where o.id = p_order_id
          and o.current_status in (${sql.raw(LOCKED_STATUSES)})
      )
    $$
  `.execute(db);

  // ── orders: column freeze (see the note above on why this is not RLS) ──
  await sql`
    create or replace function public.reject_locked_order_edit() returns trigger
    language plpgsql as $$
    declare
      v_ignore text[] := ${sql.raw(MUTABLE_WHILE_LOCKED)};
      v_generated text[];
    begin
      -- OLD is the pre-update row, so the transition INTO a locked status is
      -- itself allowed; only edits made once already locked are refused.
      if not public.order_is_locked(old.id) then
        return new;
      end if;

      -- STORED generated columns (balance_cents today) are still NULL in NEW
      -- inside a BEFORE trigger while OLD carries their computed value, so a
      -- naive OLD/NEW diff reports every single update as a change and nothing
      -- — not even a status advance — can ever touch a locked order. Read them
      -- from the catalogue rather than naming balance_cents, so a generated
      -- column added later cannot silently reintroduce that deadlock. Ignoring
      -- them loses nothing: a generated column only changes when one of the
      -- columns it derives from does, and those are compared.
      select coalesce(array_agg(a.attname::text), '{}') into v_generated
        from pg_attribute a
       where a.attrelid = 'public.orders'::regclass
         and a.attnum > 0 and not a.attisdropped and a.attgenerated <> '';
      v_ignore := v_ignore || v_generated;

      if (to_jsonb(new) - v_ignore) is distinct from (to_jsonb(old) - v_ignore) then
        raise exception
          'order % is locked: it has been sent to the vendor. Amend the manufacturing measurements instead.',
          old.display_id
          using errcode = 'check_violation';
      end if;
      return new;
    end
    $$
  `.execute(db);

  // Name sorts before orders_set_updated_at, so this runs first. Harmless
  // either way — updated_at is on the mutable list.
  await sql`
    create trigger orders_reject_locked_edit
      before update on public.orders
      for each row execute function public.reject_locked_order_edit()
  `.execute(db);

  // ── rooms ─────────────────────────────────────────────────────────────
  await sql`drop policy "rooms_write_owner_admin" on public.rooms`.execute(db);
  await sql`
    create policy "rooms_write_owner_admin"
      on public.rooms for all to authenticated
      using (
        exists (
          select 1 from public.orders o
          where o.id = rooms.order_id
            and (o.consultant_id = auth.uid() or public.is_admin())
        )
        and not public.order_is_locked(rooms.order_id)
      )
      with check (
        exists (
          select 1 from public.orders o
          where o.id = rooms.order_id
            and (o.consultant_id = auth.uid() or public.is_admin())
        )
        and not public.order_is_locked(rooms.order_id)
      )
  `.execute(db);

  // ── windows ───────────────────────────────────────────────────────────
  await sql`drop policy "windows_write_owner_admin" on public.windows`.execute(
    db,
  );
  await sql`
    create policy "windows_write_owner_admin"
      on public.windows for all to authenticated
      using (
        exists (
          select 1 from public.rooms r
            join public.orders o on o.id = r.order_id
          where r.id = windows.room_id
            and (o.consultant_id = auth.uid() or public.is_admin())
            and not public.order_is_locked(r.order_id)
        )
      )
      with check (
        exists (
          select 1 from public.rooms r
            join public.orders o on o.id = r.order_id
          where r.id = windows.room_id
            and (o.consultant_id = auth.uid() or public.is_admin())
            and not public.order_is_locked(r.order_id)
        )
      )
  `.execute(db);

  // ── mesh_panels ───────────────────────────────────────────────────────
  await sql`drop policy "mesh_panels_write_owner_admin" on public.mesh_panels`.execute(
    db,
  );
  await sql`
    create policy "mesh_panels_write_owner_admin"
      on public.mesh_panels for all to authenticated
      using (
        exists (
          select 1 from public.rooms r
            join public.orders o on o.id = r.order_id
          where r.id = mesh_panels.room_id
            and (o.consultant_id = auth.uid() or public.is_admin())
            and not public.order_is_locked(r.order_id)
        )
      )
      with check (
        exists (
          select 1 from public.rooms r
            join public.orders o on o.id = r.order_id
          where r.id = mesh_panels.room_id
            and (o.consultant_id = auth.uid() or public.is_admin())
            and not public.order_is_locked(r.order_id)
        )
      )
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Restores the policy bodies exactly as 20260530065634_initial.ts and
  // 20260806100000_mesh_product_line.ts left them.
  await sql`drop policy "mesh_panels_write_owner_admin" on public.mesh_panels`.execute(
    db,
  );
  await sql`
    create policy "mesh_panels_write_owner_admin"
      on public.mesh_panels for all to authenticated
      using (
        exists (
          select 1 from public.rooms r
            join public.orders o on o.id = r.order_id
          where r.id = mesh_panels.room_id
            and (o.consultant_id = auth.uid() or public.is_admin())
        )
      )
      with check (
        exists (
          select 1 from public.rooms r
            join public.orders o on o.id = r.order_id
          where r.id = mesh_panels.room_id
            and (o.consultant_id = auth.uid() or public.is_admin())
        )
      )
  `.execute(db);

  await sql`drop policy "windows_write_owner_admin" on public.windows`.execute(
    db,
  );
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

  await sql`drop policy "rooms_write_owner_admin" on public.rooms`.execute(db);
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

  await sql`drop trigger orders_reject_locked_edit on public.orders`.execute(db);
  await sql`drop function public.reject_locked_order_edit()`.execute(db);
  await sql`drop function public.order_is_locked(uuid)`.execute(db);
}
