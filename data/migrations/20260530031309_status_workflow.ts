import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
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

      if v_new_idx <> v_current_idx and v_new_idx <> v_current_idx + 1 then
        raise exception 'invalid status transition: % -> %', v_current, new.status;
      end if;

      return new;
    end
    $$
  `.execute(db);

  await sql`
    create trigger ose_validate_transition
      before insert on public.order_status_events
      for each row execute function public.validate_status_transition()
  `.execute(db);

  await sql`create extension if not exists pg_trgm`.execute(db);

  await sql`create index customers_name_trgm on public.customers using gin (lower(name) gin_trgm_ops)`.execute(db);
  await sql`create index customers_mobile_trgm on public.customers using gin (mobile gin_trgm_ops)`.execute(db);
  await sql`create index orders_development_trgm on public.orders using gin (lower(development) gin_trgm_ops)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop index if exists public.orders_development_trgm`.execute(db);
  await sql`drop index if exists public.customers_mobile_trgm`.execute(db);
  await sql`drop index if exists public.customers_name_trgm`.execute(db);
  await sql`drop trigger if exists ose_validate_transition on public.order_status_events`.execute(db);
  await sql`drop function if exists public.validate_status_transition()`.execute(db);
}
