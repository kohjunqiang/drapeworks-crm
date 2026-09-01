import { sql, type Kysely } from "kysely";

// Quoting the customer and receiving their deposit are separate business
// events. Keeping both in the order timeline lets the linked lead move from
// Send Quotation to Decision Pending, then to Won, at the exact human actions.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter type public.fulfilment_status add value if not exists 'quotation_sent' after 'order_recorded'`.execute(db);
  await replaceFlow(db, true);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`do $$ begin if exists (select 1 from public.orders where current_status = 'quotation_sent') then raise exception 'cannot reverse: orders exist at quotation_sent'; end if; end $$`.execute(db);
  await replaceFlow(db, false);
  // PostgreSQL cannot safely drop an enum value. The unused label remains, but
  // the restored transition function makes it unreachable.
}

async function replaceFlow(db: Kysely<unknown>, quoted: boolean) {
  const flow = quoted
    ? "array['order_recorded','quotation_sent','deposit_received','po_ready','sent_to_vendor','sent_logistic','shipping_sg','delivered_checked','fulfilment','completed']"
    : "array['order_recorded','deposit_received','po_ready','sent_to_vendor','sent_logistic','shipping_sg','delivered_checked','fulfilment','completed']";
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
