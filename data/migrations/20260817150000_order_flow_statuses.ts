import { sql, type Kysely } from "kysely";

// Phase 13A — the fulfilment flow started in the wrong place and skipped two
// real events. An order is *recorded*, not *made*, at creation: nothing has
// been manufactured and the company is waiting on a deposit. And the jump from
// "we took the order" straight to "we handed it to a freight partner" swallowed
// both the deposit arriving and the order going to the vendor who builds it.
//
// `rename value` rewrites every existing row, the orders.current_status default
// and every order_status_events row transparently — enum values are stored by
// internal id, not by text.
//
// IMPORTANT: Postgres forbids *using* an enum value in the same transaction
// that adds it, and the Kysely migrator wraps each migration in one. This
// migration therefore only adds the values; it never inserts or compares
// against them. Redefining validate_status_transition() below is safe because
// a plpgsql body is stored as text and its flow array is text[], not the enum.

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter type public.fulfilment_status rename value 'order_made' to 'order_recorded'
  `.execute(db);

  await sql`
    alter type public.fulfilment_status add value 'deposit_received' after 'order_recorded'
  `.execute(db);

  await sql`
    alter type public.fulfilment_status add value 'sent_to_vendor' after 'deposit_received'
  `.execute(db);

  // Same ±1 logic as before; only the flow array changes.
  await sql`
    create or replace function public.validate_status_transition() returns trigger
    language plpgsql as $$
    declare
      v_current public.fulfilment_status;
      v_flow text[] := array[
        'order_recorded','deposit_received','sent_to_vendor',
        'sent_logistic','shipping_sg','delivered_checked','fulfilment','completed'
      ];
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
}

// Postgres cannot drop a value from an enum. Reversing means rebuilding the
// type, which would fail against any row already sitting on a new value — so
// down() only restores the name and the old flow array, and refuses if any
// order is *currently sitting* at one of the two new statuses.
//
// Note the guard reads orders.current_status only, not order_status_events:
// an order that passed through sent_to_vendor and moved on leaves a history row
// on a new value and still passes. That is deliberate — the added enum labels
// are never dropped, so such rows stay valid; the guard exists to stop a
// reversal that would strand a LIVE order on a status the old flow cannot
// advance.
export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    do $$
    begin
      if exists (
        select 1 from public.orders
        where current_status in ('deposit_received','sent_to_vendor')
      ) then
        raise exception 'cannot reverse: orders exist at deposit_received or sent_to_vendor';
      end if;
    end
    $$
  `.execute(db);

  await sql`
    alter type public.fulfilment_status rename value 'order_recorded' to 'order_made'
  `.execute(db);

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
}
