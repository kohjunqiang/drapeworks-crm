import { sql, type Kysely } from "kysely";

// Mark as Won links an existing order to its originating lead. Orders at
// po_ready and beyond are frozen by reject_locked_order_edit, so the server
// action stamps a transaction-local actor and this branch permits exactly
// one change — lead_id on a previously UNLINKED order — for an active
// consultant or admin. Unlinking or reassigning a locked order stays
// rejected: the deferred Won guard only inspects NEW.lead_id on update, so
// widening this to unlinks would let a locked order leave Won leads behind.
// Every other locked column still compares old against new, and the admin
// payment branch is unchanged.
//
// Read-only local verification (run inside one transaction, then roll back):
//   select set_config('app.lead_link_actor', '<active consultant uuid>', true);
//   update orders set lead_id = '<lead>' where id = '<locked unlinked order>';   -- allowed
//   update orders set lead_id = null where id = '<locked linked order>';         -- rejected
//   update orders set lead_id = '<other lead>' where id = '<locked linked>';     -- rejected
//   update orders set delivery_address_id = '<x>' where id = '<locked order>';   -- rejected
// Without the actor set, all four updates must be rejected.
export async function up(db: Kysely<unknown>): Promise<void> {
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

      begin
        v_actor := nullif(current_setting('app.lead_link_actor', true), '')::uuid;
      exception when invalid_text_representation then
        v_actor := null;
      end;
      if v_actor is not null
         and exists (
           select 1 from public.profiles p
            where p.id = v_actor and p.role in ('consultant', 'admin') and p.is_active
         )
         and old.lead_id is null
         and new.lead_id is not null
         and (to_jsonb(new) - v_ignore - array['lead_id']::text[])
             is not distinct from
             (to_jsonb(old) - v_ignore - array['lead_id']::text[])
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
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Restore the pre-branch body from 20260903124000 verbatim: the admin
  // payment bypass remains, the lead-link actor branch is removed.
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
}
