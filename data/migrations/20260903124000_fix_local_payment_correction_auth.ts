import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`drop function public.amend_order_payment(uuid, integer, integer)`.execute(db);

  // The app can use a deliberate local-auth bypass, so auth.uid() is absent in
  // development. The RPC is therefore service-role-only and verifies the actor
  // supplied by the already-authenticated server action against profiles.
  await sql`
    create or replace function public.reject_locked_order_edit() returns trigger
    language plpgsql as $$
    declare
      v_ignore text[] := array[
        'current_status','updated_at','order_reference','delivery_vendor_id',
        'po_customer_reference','goods_overseas_tracking_number',
        'goods_local_delivery_number','track_overseas_tracking_number',
        'track_local_delivery_number'
      ]::text[];
      v_generated text[];
      v_actor uuid;
    begin
      if not public.order_is_locked(old.id) then return new; end if;
      select coalesce(array_agg(a.attname::text), '{}') into v_generated
        from pg_attribute a where a.attrelid = 'public.orders'::regclass
        and a.attnum > 0 and not a.attisdropped and a.attgenerated <> '';
      v_ignore := v_ignore || v_generated;

      begin
        v_actor := nullif(current_setting('app.admin_payment_actor', true), '')::uuid;
      exception when invalid_text_representation then
        v_actor := null;
      end;
      if v_actor is not null
         and exists (
           select 1 from public.profiles p
            where p.id = v_actor and p.role = 'admin' and p.is_active
         )
         and (to_jsonb(new) - v_ignore - array['price_quoted_cents','deposit_cents']::text[])
             is not distinct from
             (to_jsonb(old) - v_ignore - array['price_quoted_cents','deposit_cents']::text[])
      then
        return new;
      end if;

      if (to_jsonb(new) - v_ignore) is distinct from (to_jsonb(old) - v_ignore) then
        raise exception 'order % is locked: manufacturing inputs cannot be edited.', old.display_id
          using errcode = 'check_violation';
      end if;
      return new;
    end
    $$
  `.execute(db);

  await sql`
    create function public.amend_order_payment(
      p_order_id uuid,
      p_quoted_cents integer,
      p_deposit_cents integer,
      p_actor_id uuid
    ) returns void
    language plpgsql
    security definer
    set search_path = public
    as $$
    declare
      v_order public.orders%rowtype;
    begin
      if not exists (
        select 1 from public.profiles p
         where p.id = p_actor_id and p.role = 'admin' and p.is_active
      ) then
        raise exception 'admin access required' using errcode = 'insufficient_privilege';
      end if;
      if p_quoted_cents < 0 or p_quoted_cents > 100000000
         or p_deposit_cents < 0 or p_deposit_cents > p_quoted_cents then
        raise exception 'invalid payment amounts' using errcode = 'check_violation';
      end if;

      select * into v_order from public.orders where id = p_order_id for update;
      if not found then raise exception 'order not found'; end if;
      if v_order.price_quoted_cents = p_quoted_cents
         and v_order.deposit_cents = p_deposit_cents then
        return;
      end if;

      perform set_config('app.admin_payment_actor', p_actor_id::text, true);
      update public.orders
         set price_quoted_cents = p_quoted_cents,
             deposit_cents = p_deposit_cents
       where id = p_order_id;

      insert into public.order_status_events(order_id, status, note, created_by)
      values (
        p_order_id,
        v_order.current_status,
        '[PAYMENT AMENDED] Quoted $' || trim(to_char(v_order.price_quoted_cents / 100.0, 'FM999999990.00'))
          || ' → $' || trim(to_char(p_quoted_cents / 100.0, 'FM999999990.00'))
          || '; deposit $' || trim(to_char(v_order.deposit_cents / 100.0, 'FM999999990.00'))
          || ' → $' || trim(to_char(p_deposit_cents / 100.0, 'FM999999990.00')),
        p_actor_id
      );
    end
    $$
  `.execute(db);
  await sql`revoke all on function public.amend_order_payment(uuid, integer, integer, uuid) from public, anon, authenticated`.execute(db);
  await sql`grant execute on function public.amend_order_payment(uuid, integer, integer, uuid) to service_role`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  void db;
  throw new Error("Restore the preceding authenticated payment RPC explicitly before rollback.");
}
