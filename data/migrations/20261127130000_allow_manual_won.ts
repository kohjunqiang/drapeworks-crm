import { sql, type Kysely } from "kysely";

// Consultants may now set Won directly from the lead editors, so the deferred
// constraints that required a recorded deposit on a linked order are obsolete.
// The order-status -> lead milestone sync in the app and the lead_status
// derivation trigger are untouched by this change.
//
// The trigger functions are intentionally kept: a rollback re-executes the
// latest bodies (which already count installation_completed as deposited) and
// re-attaches the constraint triggers.

const DEPOSITED_STATUSES = `
  'deposit_received', 'po_ready', 'sent_to_vendor', 'sent_logistic',
  'shipping_sg', 'delivered_checked', 'fulfilment', 'installation_completed',
  'completed'
`;

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    drop trigger if exists leads_require_recorded_deposit on public.leads;
    drop trigger if exists orders_preserve_won_deposit on public.orders;
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Constraint triggers do not retro-validate existing rows, so refuse the
  // rollback while manually closed Won leads would violate the old invariant.
  // Nothing is rewritten — the operator reconciles those leads first.
  await sql.raw(`
    do $$
    begin
      if exists (
        select 1 from public.leads l
         where l.funnel_stage = 'Won'
           and not exists (
             select 1 from public.orders o
              where o.lead_id = l.id
                and o.current_status::text in (${DEPOSITED_STATUSES})
           )
      ) then
        raise exception 'Cannot restore the deposit prerequisite while Won leads lack a linked order with a recorded deposit';
      end if;
    end
    $$
  `).execute(db);

  await sql.raw(`
    create or replace function public.leads_require_recorded_deposit()
    returns trigger language plpgsql
    set search_path = ''
    as $$
    begin
      if new.funnel_stage = 'Won'
         and not exists (
           select 1 from public.orders o
            where o.lead_id = new.id
              and o.current_status::text in (${DEPOSITED_STATUSES})
         ) then
        raise exception 'Record the deposit on the linked order before marking this lead Won';
      end if;
      return null;
    end
    $$;

    create or replace function public.orders_preserve_won_deposit()
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
              and o.current_status::text in (${DEPOSITED_STATUSES})
         ) then
        raise exception 'A Won lead must retain an order with a recorded deposit';
      end if;
      return null;
    end
    $$;
  `).execute(db);

  await sql`
    drop trigger if exists leads_require_recorded_deposit on public.leads;
    create constraint trigger leads_require_recorded_deposit
      after insert or update of funnel_stage on public.leads
      deferrable initially deferred
      for each row execute function public.leads_require_recorded_deposit();

    drop trigger if exists orders_preserve_won_deposit on public.orders;
    create constraint trigger orders_preserve_won_deposit
      after insert or update or delete on public.orders
      deferrable initially deferred
      for each row execute function public.orders_preserve_won_deposit();
  `.execute(db);
}
