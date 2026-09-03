import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  // Isaac's historical order has a recorded deposit and is already with the
  // vendor. Complete the one-time lead migration through the event ledger so
  // current state and audit history agree.
  await sql`
    do $$
    declare
      v_lead_id constant uuid := '624fbd4f-85cc-4d39-b840-ba4d4170996e';
      v_order_id constant uuid := '9e9dac67-3e65-4773-88de-0c1b13672f59';
      v_from_stage public.lead_funnel_stage;
    begin
      select l.funnel_stage into v_from_stage
        from public.leads l
       where l.id = v_lead_id
         and l.name = 'Isaac 9235 4864'
         and l.lead_ref = 'WA-SEM-sync-f75da4c7f4';

      if not found then
        raise exception 'Isaac lead was not found at the expected identity';
      end if;

      if not exists (
        select 1
          from public.orders o
         where o.id = v_order_id
           and o.lead_id = v_lead_id
           and o.order_reference = '10054'
           and o.deposit_cents > 0
           and o.current_status in (
             'deposit_received', 'po_ready', 'sent_to_vendor', 'sent_logistic',
             'shipping_sg', 'delivered_checked', 'fulfilment', 'completed'
           )
      ) then
        raise exception 'Isaac PO 10054 does not have the expected recorded deposit';
      end if;

      if v_from_stage <> 'Won' then
        insert into public.lead_stage_events (
          lead_id, from_stage, to_stage, changed_at, changed_by, source
        ) values (
          v_lead_id, v_from_stage, 'Won', now(), null, 'system'
        );

        update public.leads
           set funnel_stage = 'Won',
               last_outcome = 'Customer Confirmed',
               closure_reason = null,
               updated_at = now()
         where id = v_lead_id;
      end if;
    end
    $$
  `.execute(db);
}

export async function down(): Promise<void> {
  // Intentionally retained: this migration records confirmed business data.
}
