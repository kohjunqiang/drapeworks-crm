import { sql, type Kysely } from "kysely";
async function validator(db: Kysely<unknown>, recovery: boolean) {
  await sql.raw(`create or replace function public.validate_status_transition() returns trigger language plpgsql as $$
  declare v_current public.fulfilment_status; v_flow text[] := array['order_recorded','quotation_sent','deposit_received','po_ready','sent_to_vendor','sent_logistic','shipping_sg','delivered_checked','fulfilment','installation_completed','completed']; v_current_idx int; v_new_idx int;
  begin
    select current_status into v_current from public.orders where id=new.order_id;
    v_current_idx:=array_position(v_flow,v_current::text); v_new_idx:=array_position(v_flow,new.status::text);
    if v_current_idx is null or v_new_idx is null then raise exception 'unknown status'; end if;
    if abs(v_new_idx-v_current_idx)<=1 then return new; end if;
    if v_current::text='fulfilment' and new.status::text='completed' and split_part(coalesce(new.note,''),chr(10),1)='Confirmed remaining balance received in full.' then return new; end if;
    ${recovery ? `if v_current::text='order_recorded' and new.status::text='deposit_received' and exists(select 1 from public.order_invoice_recovery_permits p where p.order_id=new.order_id and p.transaction_id=txid_current() and p.actor_id=new.created_by) then return new; end if;` : ""}
    raise exception 'invalid status transition: % -> %',v_current,new.status;
  end $$`).execute(db);
}
export async function up(db: Kysely<unknown>) {
  await sql`create table if not exists public.order_invoice_recovery_permits(order_id uuid primary key references public.orders(id) on delete cascade, transaction_id bigint not null, actor_id uuid not null references public.profiles(id));
  alter table public.order_invoice_recovery_permits enable row level security;
  revoke all on public.order_invoice_recovery_permits from public;`.execute(db);
  await validator(db, true);
  await sql`drop function if exists public.recover_order_invoice_deposit(uuid,uuid,text,text,integer,integer,uuid); create or replace function public.recover_order_invoice_deposit(p_order uuid,p_quote uuid,p_invoice text,p_payment text,p_total integer,p_deposit integer,p_fingerprint text,p_actor uuid) returns void
  language plpgsql security definer set search_path=public as $$
  declare v_order public.orders%rowtype;
  begin
    if not exists(select 1 from public.profiles where id=p_actor and role in ('admin','ops') and is_active) then raise exception 'operations access required'; end if;
    select * into v_order from public.orders where id=p_order for update;
    if not found or v_order.is_draft or v_order.current_status::text<>'order_recorded' or v_order.price_quoted_cents<>p_total or v_order.deposit_cents<>p_deposit or p_deposit<=0 or p_deposit>p_total then raise exception 'order changed or not eligible for invoice recovery'; end if;
    perform 1 from public.order_quotations q join public.order_invoice_commercial c on c.order_id=q.order_id and c.quotation_id=q.id
      where q.id=p_quote and q.order_id=p_order and q.superseded_at is null and q.status not in ('syncing','sending','superseded')
      and q.zoho_invoice_id=p_invoice and q.zoho_payment_id=p_payment and p_invoice<>'' and p_payment<>''
      and q.invoice_sync_state='created' and q.payment_sync_state='created' and c.state='synced' and c.invoice_id=p_invoice
      and (c.document->>'totalCents')::integer=p_total and c.synced_fingerprint=p_fingerprint for update of q,c;
    if not found then raise exception 'verified commercial invoice and payment required'; end if;
    insert into public.order_invoice_recovery_permits values(p_order,txid_current(),p_actor);
    insert into public.order_status_events(order_id,status,note,created_by) values(p_order,'deposit_received','Recovered order stage from an existing verified Zoho invoice and matching deposit payment. No quotation-sent event was inferred.',p_actor);
    delete from public.order_invoice_recovery_permits where order_id=p_order;
  end $$;
  revoke all on function public.recover_order_invoice_deposit(uuid,uuid,text,text,integer,integer,text,uuid) from public;
  grant execute on function public.recover_order_invoice_deposit(uuid,uuid,text,text,integer,integer,text,uuid) to service_role;`.execute(db);
}
export async function down(db: Kysely<unknown>) {
  await validator(db, false);
  await sql`drop function public.recover_order_invoice_deposit(uuid,uuid,text,text,integer,integer,text,uuid); drop table public.order_invoice_recovery_permits;`.execute(db);
}
