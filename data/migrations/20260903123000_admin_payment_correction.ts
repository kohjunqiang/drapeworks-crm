import { sql, type Kysely } from "kysely";

async function replaceLock(db: Kysely<unknown>, allowAdminPayment: boolean) {
  const guardedException = allowAdminPayment
    ? sql`
        if current_setting('app.admin_payment_amendment', true) = 'on'
           and public.is_admin()
           and (to_jsonb(new) - v_ignore - array['price_quoted_cents','deposit_cents']::text[])
               is not distinct from
               (to_jsonb(old) - v_ignore - array['price_quoted_cents','deposit_cents']::text[])
        then
          return new;
        end if;
      `
    : sql``;

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
    begin
      if not public.order_is_locked(old.id) then return new; end if;
      select coalesce(array_agg(a.attname::text), '{}') into v_generated
        from pg_attribute a where a.attrelid = 'public.orders'::regclass
        and a.attnum > 0 and not a.attisdropped and a.attgenerated <> '';
      v_ignore := v_ignore || v_generated;
      ${guardedException}
      if (to_jsonb(new) - v_ignore) is distinct from (to_jsonb(old) - v_ignore) then
        raise exception 'order % is locked: manufacturing inputs cannot be edited.', old.display_id
          using errcode = 'check_violation';
      end if;
      return new;
    end
    $$
  `.execute(db);
}

export async function up(db: Kysely<unknown>): Promise<void> {
  await replaceLock(db, true);
  await sql`
    create or replace function public.amend_order_payment(
      p_order_id uuid,
      p_quoted_cents integer,
      p_deposit_cents integer
    ) returns void
    language plpgsql
    security definer
    set search_path = public
    as $$
    declare
      v_order public.orders%rowtype;
    begin
      if not public.is_admin() then
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

      perform set_config('app.admin_payment_amendment', 'on', true);
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
        auth.uid()
      );
    end
    $$
  `.execute(db);
  await sql`revoke all on function public.amend_order_payment(uuid, integer, integer) from public`.execute(db);
  await sql`grant execute on function public.amend_order_payment(uuid, integer, integer) to authenticated`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop function public.amend_order_payment(uuid, integer, integer)`.execute(db);
  await replaceLock(db, false);
}
