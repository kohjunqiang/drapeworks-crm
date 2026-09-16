import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  // These two historical manual orders both have recorded deposits and have
  // progressed beyond PO Ready. Complete their one-time lead migration through
  // the event ledger so current state and audit history agree.
  await sql`
    do $$
    begin
      if not exists (
        select 1
          from public.leads l
          join public.orders o on o.lead_id = l.id
         where l.id = '65373db6-270b-4efb-821b-35e8a3333c71'::uuid
           and l.name = 'Germaine'
           and l.lead_ref = 'WA-6596799699'
           and o.id = 'a31fd642-0fe2-4066-9762-880b0e023471'::uuid
           and o.order_reference = '10043'
           and o.deposit_cents > 0
           and o.current_status in (
             'deposit_received', 'po_ready', 'sent_to_vendor', 'sent_logistic',
             'shipping_sg', 'delivered_checked', 'fulfilment', 'completed'
           )
      ) then
        raise exception 'Germaine PO 10043 does not have the expected recorded deposit';
      end if;

      if not exists (
        select 1
          from public.leads l
          join public.orders o on o.lead_id = l.id
         where l.id = '39de703e-e1a6-47dc-b5bb-36440d4984b3'::uuid
           and l.name = 'Dawn C. (Hello SG Deals)'
           and l.lead_ref = 'TG-432732342'
           and o.id = '1f69472d-2732-4d2b-93bb-eac1e46c5977'::uuid
           and o.order_reference = '10047'
           and o.deposit_cents > 0
           and o.current_status in (
             'deposit_received', 'po_ready', 'sent_to_vendor', 'sent_logistic',
             'shipping_sg', 'delivered_checked', 'fulfilment', 'completed'
           )
      ) then
        raise exception 'Dawn PO 10047 does not have the expected recorded deposit';
      end if;

      insert into public.lead_stage_events (
        lead_id, from_stage, to_stage, changed_at, changed_by, source
      )
      select l.id, l.funnel_stage, 'Won', now(), null, 'system'
        from public.leads l
       where l.id in (
         '65373db6-270b-4efb-821b-35e8a3333c71'::uuid,
         '39de703e-e1a6-47dc-b5bb-36440d4984b3'::uuid
       )
         and l.funnel_stage <> 'Won';

      update public.leads
         set funnel_stage = 'Won',
             last_outcome = 'Customer Confirmed',
             closure_reason = null,
             updated_at = now()
       where id in (
         '65373db6-270b-4efb-821b-35e8a3333c71'::uuid,
         '39de703e-e1a6-47dc-b5bb-36440d4984b3'::uuid
       )
         and funnel_stage <> 'Won';
    end
    $$
  `.execute(db);
}

export async function down(): Promise<void> {
  // Intentionally retained: this migration records confirmed business data.
}
