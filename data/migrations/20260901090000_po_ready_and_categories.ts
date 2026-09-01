import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter type public.fulfilment_status add value if not exists 'po_ready' after 'deposit_received'`.execute(db);

  await db.schema.alterTable("manufacture_pos")
    .addColumn("category", "text")
    .execute();
  await sql`alter table public.manufacture_pos add constraint manufacture_pos_category_known check (category is null or category in ('day','night','blind'))`.execute(db);
  await db.schema.alterTable("orders").addColumn("site_address", "varchar(500)").execute();
  await db.schema.alterTable("orders")
    .addColumn("goods_overseas_tracking_number", "varchar(200)")
    .addColumn("goods_local_delivery_number", "varchar(200)")
    .addColumn("track_overseas_tracking_number", "varchar(200)")
    .addColumn("track_local_delivery_number", "varchar(200)")
    .execute();

  await replaceFlow(db, true);
  await replaceLock(db, true);
  await replaceEditLock(db, true);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`do $$ begin if exists (select 1 from public.orders where current_status = 'po_ready') then raise exception 'cannot reverse: orders exist at po_ready'; end if; end $$`.execute(db);
  await replaceFlow(db, false);
  await replaceLock(db, false);
  await replaceEditLock(db, false);
  await db.schema.alterTable("orders")
    .dropColumn("goods_overseas_tracking_number")
    .dropColumn("goods_local_delivery_number")
    .dropColumn("track_overseas_tracking_number")
    .dropColumn("track_local_delivery_number")
    .execute();
  await db.schema.alterTable("orders").dropColumn("site_address").execute();
  await db.schema.alterTable("manufacture_pos").dropColumn("category").execute();
}

async function replaceEditLock(db: Kysely<unknown>, tracking: boolean) {
  const ignore = tracking
    ? "array['current_status','updated_at','order_reference','delivery_vendor_id','po_customer_reference','goods_overseas_tracking_number','goods_local_delivery_number','track_overseas_tracking_number','track_local_delivery_number']::text[]"
    : "array['current_status','updated_at','order_reference','delivery_vendor_id','po_customer_reference']::text[]";
  await sql`
    create or replace function public.reject_locked_order_edit() returns trigger
    language plpgsql as $$
    declare
      v_ignore text[] := ${sql.raw(ignore)};
      v_generated text[];
    begin
      if not public.order_is_locked(old.id) then return new; end if;
      select coalesce(array_agg(a.attname::text), '{}') into v_generated
        from pg_attribute a where a.attrelid = 'public.orders'::regclass
        and a.attnum > 0 and not a.attisdropped and a.attgenerated <> '';
      v_ignore := v_ignore || v_generated;
      if (to_jsonb(new) - v_ignore) is distinct from (to_jsonb(old) - v_ignore) then
        raise exception 'order % is locked: manufacturing inputs cannot be edited.', old.display_id
          using errcode = 'check_violation';
      end if;
      return new;
    end
    $$
  `.execute(db);
}

async function replaceFlow(db: Kysely<unknown>, ready: boolean) {
  const flow = ready
    ? "array['order_recorded','deposit_received','po_ready','sent_to_vendor','sent_logistic','shipping_sg','delivered_checked','fulfilment','completed']"
    : "array['order_recorded','deposit_received','sent_to_vendor','sent_logistic','shipping_sg','delivered_checked','fulfilment','completed']";
  await sql`
    create or replace function public.validate_status_transition() returns trigger
    language plpgsql as $$
    declare
      v_current public.fulfilment_status;
      v_flow text[] := ${sql.raw(flow)};
      v_current_idx int;
      v_new_idx int;
    begin
      select current_status into v_current from public.orders where id = new.order_id;
      v_current_idx := array_position(v_flow, v_current::text);
      v_new_idx := array_position(v_flow, new.status::text);
      if v_new_idx is null then raise exception 'unknown status'; end if;
      if v_new_idx = v_current_idx then return new; end if;
      if v_new_idx = v_current_idx + 1 then return new; end if;
      if v_new_idx = v_current_idx - 1 then return new; end if;
      raise exception 'invalid status transition: % -> %', v_current, new.status;
    end
    $$
  `.execute(db);
}

async function replaceLock(db: Kysely<unknown>, ready: boolean) {
  const statuses = ready
    ? "'po_ready','sent_to_vendor','sent_logistic','shipping_sg','delivered_checked','fulfilment','completed'"
    : "'sent_to_vendor','sent_logistic','shipping_sg','delivered_checked','fulfilment','completed'";
  await sql`
    create or replace function public.order_is_locked(p_order_id uuid) returns boolean
    language sql stable security definer set search_path = public as $$
      select exists (select 1 from public.orders o where o.id = p_order_id and o.current_status::text in (${sql.raw(statuses)}))
    $$
  `.execute(db);
}
