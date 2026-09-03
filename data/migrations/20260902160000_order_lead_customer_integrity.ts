import { sql, type Kysely } from "kysely";

// A lead is the originating sales opportunity, while customers are the
// canonical contact identity and may own many orders. A linked lead and order
// must therefore always point at the same customer. Keep the application
// checks for friendly errors; these triggers are the final backstop for direct
// imports, maintenance scripts and future write paths.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    do $$
    begin
      if exists (
        select 1
        from public.orders o
        join public.leads l on l.id = o.lead_id
        where l.customer_id is distinct from o.customer_id
      ) then
        raise exception 'cannot enforce order/lead customer integrity: mismatched links exist';
      end if;
    end
    $$
  `.execute(db);

  // Snapshot missing legacy order details once. Do not make the order list
  // fall back to live lead fields: a later lead edit must not rewrite history.
  // The manufacturing lock is suspended only inside this migration and is
  // restored before the transaction can commit.
  await sql`alter table public.orders disable trigger orders_reject_locked_edit`.execute(db);
  await sql`
    update public.orders o
       set development = case
             when nullif(btrim(o.development), '') is null
               then nullif(btrim(l.development), '')
             else o.development
           end,
           move_in_date = coalesce(o.move_in_date, l.move_in_date),
           updated_at = now()
      from public.leads l
     where o.lead_id = l.id
       and (
         (nullif(btrim(o.development), '') is null
           and nullif(btrim(l.development), '') is not null)
         or (o.move_in_date is null and l.move_in_date is not null)
       )
  `.execute(db);
  await sql`alter table public.orders enable trigger orders_reject_locked_edit`.execute(db);

  // Reconcile converted legacy links whose ORDER WORKFLOW records receipt of a
  // deposit. deposit_cents is only the amount quoted on the consultation form;
  // it is positive before the customer pays and must never be used as evidence.
  await sql`
    insert into public.lead_stage_events (
      lead_id, from_stage, to_stage, changed_at, changed_by, source
    )
    select l.id, l.funnel_stage, 'Won'::lead_funnel_stage, now(), null, 'system'
      from public.leads l
      join public.orders o on o.lead_id = l.id
     where o.current_status in (
       'deposit_received', 'po_ready', 'sent_to_vendor', 'sent_logistic',
       'shipping_sg', 'delivered_checked', 'fulfilment', 'completed'
     )
       and l.funnel_stage <> 'Won'
  `.execute(db);
  await sql`
    update public.leads l
       set funnel_stage = 'Won',
           last_outcome = 'Customer Confirmed',
           updated_at = now()
      from public.orders o
     where o.lead_id = l.id
       and o.current_status in (
         'deposit_received', 'po_ready', 'sent_to_vendor', 'sent_logistic',
         'shipping_sg', 'delivered_checked', 'fulfilment', 'completed'
       )
       and l.funnel_stage <> 'Won'
  `.execute(db);

  // A composite foreign key expresses the invariant directly and lets
  // PostgreSQL handle concurrency correctly. RESTRICT is deliberate: once a
  // lead is the source of an order it is historical business evidence and may
  // be archived, but not deleted or reassigned to another customer.
  await sql`
    alter table public.leads
      add constraint leads_id_customer_id_unique unique (id, customer_id)
  `.execute(db);
  await sql`
    alter table public.orders
      add constraint orders_lead_customer_id_fkey
      foreign key (lead_id, customer_id)
      references public.leads (id, customer_id)
      on update restrict on delete restrict
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table public.orders drop constraint orders_lead_customer_id_fkey;
    alter table public.leads drop constraint leads_id_customer_id_unique;
  `.execute(db);
  // The one-time data reconciliation is intentionally retained on rollback.
}
