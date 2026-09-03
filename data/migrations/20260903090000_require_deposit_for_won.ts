import { sql, type Kysely } from "kysely";

const DEPOSITED_STATUSES = `
  'deposit_received', 'po_ready', 'sent_to_vendor', 'sent_logistic',
  'shipping_sg', 'delivered_checked', 'fulfilment', 'completed'
`;

export async function up(db: Kysely<unknown>): Promise<void> {
  // The business confirmed this legacy order has received its deposit. Record
  // the missing workflow steps instead of editing current_status directly: the
  // event ledger remains authoritative and its sync trigger advances the row.
  await sql`
    do $$
    declare
      v_order_id constant uuid := '2a55fee5-f2a3-4964-a571-5aacd110ae50';
      v_status public.fulfilment_status;
    begin
      select o.current_status into v_status
        from public.orders o
        join public.leads l on l.id = o.lead_id
       where o.id = v_order_id
         and l.name = 'Jason Chua';

      if not found then
        if exists (select 1 from public.orders where id = v_order_id) then
          raise exception 'Jason Chua order id points at an unexpected lead';
        end if;
        return;
      end if;

      if v_status = 'order_recorded' then
        insert into public.order_status_events (order_id, status, note)
        values (v_order_id, 'quotation_sent',
          '[DATA MIGRATION] Historical quotation already sent');
        v_status := 'quotation_sent';
      end if;

      if v_status = 'quotation_sent' then
        insert into public.order_status_events (order_id, status, note)
        values (v_order_id, 'deposit_received',
          '[DATA MIGRATION] Historical deposit confirmed received');
      end if;
    end
    $$
  `.execute(db);

  // Repair any lead left Won by the faulty quoted-deposit migration. Jason is
  // no longer a candidate because the real deposit was recorded above.
  await sql`
    insert into public.lead_stage_events (
      lead_id, from_stage, to_stage, changed_at, changed_by, source
    )
    select l.id, l.funnel_stage,
           case o.current_status
             when 'quotation_sent' then 'Decision Pending'::lead_funnel_stage
             else 'Send Quotation'::lead_funnel_stage
           end,
           now(), null, 'system'
      from public.leads l
      join public.orders o on o.lead_id = l.id
     where l.funnel_stage = 'Won'
       and o.current_status in ('order_recorded', 'quotation_sent')
  `.execute(db);
  await sql`
    update public.leads l
       set funnel_stage = case o.current_status
             when 'quotation_sent' then 'Decision Pending'::lead_funnel_stage
             else 'Send Quotation'::lead_funnel_stage
           end,
           last_outcome = case o.current_status
             when 'quotation_sent' then 'Quotation Sent'::lead_outcome
             else null
           end,
           updated_at = now()
      from public.orders o
     where o.lead_id = l.id
       and l.funnel_stage = 'Won'
       and o.current_status in ('order_recorded', 'quotation_sent')
  `.execute(db);

  await sql.raw(`
    create function public.leads_require_recorded_deposit()
    returns trigger language plpgsql
    set search_path = ''
    as $$
    begin
      if new.funnel_stage = 'Won'
         and not exists (
           select 1 from public.orders o
            where o.lead_id = new.id
              and o.current_status in (${DEPOSITED_STATUSES})
         ) then
        raise exception 'Record the deposit on the linked order before marking this lead Won';
      end if;
      return null;
    end
    $$;

    create constraint trigger leads_require_recorded_deposit
      after insert or update of funnel_stage on public.leads
      deferrable initially deferred
      for each row execute function public.leads_require_recorded_deposit();

    create function public.orders_preserve_won_deposit()
    returns trigger language plpgsql
    set search_path = ''
    as $$
    declare
      v_lead_id uuid := case when tg_op = 'DELETE' then old.lead_id else new.lead_id end;
    begin
      if v_lead_id is not null
         and exists (
           select 1 from public.leads l
            where l.id = v_lead_id and l.funnel_stage = 'Won'
         )
         and not exists (
           select 1 from public.orders o
            where o.lead_id = v_lead_id
              and o.current_status in (${DEPOSITED_STATUSES})
         ) then
        raise exception 'A Won lead must retain an order with a recorded deposit';
      end if;
      return null;
    end
    $$;

    create constraint trigger orders_preserve_won_deposit
      after insert or update or delete on public.orders
      deferrable initially deferred
      for each row execute function public.orders_preserve_won_deposit();
  `).execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    drop trigger if exists orders_preserve_won_deposit on public.orders;
    drop function if exists public.orders_preserve_won_deposit();
    drop trigger if exists leads_require_recorded_deposit on public.leads;
    drop function if exists public.leads_require_recorded_deposit();
  `.execute(db);
  // The historical status correction and audit events are intentionally kept.
}
