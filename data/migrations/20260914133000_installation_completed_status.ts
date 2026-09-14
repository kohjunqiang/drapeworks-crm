import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter type public.fulfilment_status add value if not exists 'installation_completed' before 'completed'`.execute(db);
  await replaceFlow(db, true);
  await replaceDepositGuards(db, true);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`do $$ begin
    if exists(select 1 from public.orders where current_status::text = 'installation_completed') then
      raise exception 'Cannot reverse while orders await their final balance';
    end if;
  end $$`.execute(db);
  await replaceFlow(db, false);
  await replaceDepositGuards(db, false);
  // PostgreSQL retains the unused enum label on rollback.
}

async function replaceFlow(db: Kysely<unknown>, includeInstallation: boolean) {
  const flow = ['order_recorded','quotation_sent','deposit_received','po_ready','sent_to_vendor',
    'sent_logistic','shipping_sg','delivered_checked','fulfilment',
    ...(includeInstallation ? ['installation_completed'] : []), 'completed'];
  await sql`
    create or replace function public.validate_status_transition() returns trigger
    language plpgsql as $$
    declare
      v_current public.fulfilment_status;
      v_flow text[] := ${sql.raw("array[" + flow.map((status) => "'" + status + "'").join(',') + "]")};
      v_current_idx int;
      v_new_idx int;
    begin
      select current_status into v_current from public.orders where id = new.order_id;
      v_current_idx := array_position(v_flow, v_current::text);
      v_new_idx := array_position(v_flow, new.status::text);
      if v_new_idx is null or v_current_idx is null then raise exception 'unknown status'; end if;
      if abs(v_new_idx - v_current_idx) <= 1 then return new; end if;
      -- The published app still combines these milestones. Accept only its
      -- explicit receipt confirmation during the rolling deployment. The new
      -- server action always advances to installation_completed first.
      if v_current::text = 'fulfilment' and new.status::text = 'completed'
         and split_part(coalesce(new.note, ''), chr(10), 1) = 'Confirmed remaining balance received in full.' then
        return new;
      end if;
      raise exception 'invalid status transition: % -> %', v_current, new.status;
    end
    $$
  `.execute(db);
}

// Both deferred constraints must recognise installation as a deposited order.
// Text comparisons also work when the enum label was added in this transaction.
async function replaceDepositGuards(db: Kysely<unknown>, includeInstallation: boolean) {
  const depositedStatuses = [
    'deposit_received', 'po_ready', 'sent_to_vendor', 'sent_logistic',
    'shipping_sg', 'delivered_checked', 'fulfilment',
    ...(includeInstallation ? ['installation_completed'] : []), 'completed',
  ].map((status) => "'" + status + "'").join(',');
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
              and o.current_status::text in (${depositedStatuses})
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
              and o.current_status::text in (${depositedStatuses})
         ) then
        raise exception 'A Won lead must retain an order with a recorded deposit';
      end if;
      return null;
    end
    $$;

  `).execute(db);
}
