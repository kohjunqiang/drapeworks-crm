import { sql, type Kysely } from "kysely";

// Allow status events that move backward by one step (revert), in addition to
// same-status (note) and +1 (advance). The auth retrofit phase will gate the
// revert case on is_admin() once the helper exists.

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

      if v_new_idx = v_current_idx then
        return new;
      end if;
      if v_new_idx = v_current_idx + 1 then
        return new;
      end if;
      if v_new_idx = v_current_idx - 1 then
        return new;
      end if;

      raise exception 'invalid status transition: % -> %', v_current, new.status;
    end
    $$
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
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
}
