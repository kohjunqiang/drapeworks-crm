import { sql, type Kysely } from "kysely";
// Invoice authority is owned by the order. Historical documents are only read
// here once to preserve identifiers and unresolved external operations.
export async function up(db: Kysely<unknown>) {
  await sql`create table public.order_invoice_ledger (
    order_id uuid primary key references public.orders(id) on delete cascade,
    organization_id text, customer_id text, invoice_id text, invoice_number text,
    document jsonb, revision integer not null default 1,
    invoice_state text not null default 'idle' check(invoice_state in ('idle','pending','uncertain','linked')),
    payment_state text not null default 'idle' check(payment_state in ('idle','pending','uncertain','linked')),
    payment_id text, payment_number text, claim_token uuid,
    legacy_unresolved boolean not null default false, legacy_operations jsonb not null default '[]',
    verified_fingerprint text, updated_by uuid references public.profiles(id), updated_at timestamptz not null default now(),
    unique(organization_id,invoice_id)
  );
  alter table public.order_invoice_ledger enable row level security;
  create table public.order_invoice_audit (
    id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders(id) on delete cascade,
    action text not null, before_document jsonb, after_document jsonb, actor_id uuid not null references public.profiles(id), created_at timestamptz not null default now()
  );
  alter table public.order_invoice_audit enable row level security;
  insert into public.order_invoice_ledger(order_id,customer_id,invoice_id,invoice_number,document,invoice_state,payment_state,payment_id,payment_number,claim_token,legacy_unresolved,updated_by)
  select q.order_id,q.zoho_contact_id,coalesce(q.zoho_invoice_id,c.invoice_id),q.zoho_invoice_number,case when c.state='synced' and (q.zoho_invoice_id is null or q.zoho_invoice_id=c.invoice_id) then c.document else null end,
    case when c.state in ('updating','uncertain') then 'uncertain' when q.invoice_sync_state in ('pending','uncertain') then q.invoice_sync_state when coalesce(q.zoho_invoice_id,c.invoice_id) is not null then 'linked' else 'idle' end,
    case when q.payment_sync_state in ('pending','uncertain') then q.payment_sync_state when q.zoho_payment_id is not null then 'linked' else 'idle' end,
    q.zoho_payment_id,q.zoho_payment_number,q.invoice_claim_token,
    (q.zoho_invoice_id is not null and c.invoice_id is not null and q.zoho_invoice_id<>c.invoice_id) or q.zoho_invoice_id is null and (coalesce(q.zoho_status='invoiced',false) or q.invoice_sync_state<>'not_started' or q.payment_sync_state<>'not_started'),q.updated_by
  from public.order_quotations q left join public.order_invoice_commercial c on c.order_id=q.order_id
  where q.superseded_at is null;
  insert into public.order_invoice_ledger(order_id,invoice_id,document,invoice_state,updated_by)
  select c.order_id,c.invoice_id,case when c.state='synced' then c.document else null end,case when c.state='synced' then 'linked' else 'uncertain' end,c.updated_by from public.order_invoice_commercial c
  on conflict(order_id) do update set invoice_id=coalesce(order_invoice_ledger.invoice_id,excluded.invoice_id),document=case when order_invoice_ledger.invoice_id is null or order_invoice_ledger.invoice_id=excluded.invoice_id then excluded.document else null end,legacy_unresolved=order_invoice_ledger.legacy_unresolved or (order_invoice_ledger.invoice_id is not null and order_invoice_ledger.invoice_id<>excluded.invoice_id);
  insert into public.order_invoice_ledger(order_id,legacy_unresolved)
  select distinct order_id,true from public.order_quotations q where q.zoho_invoice_id is not null or coalesce(q.zoho_status='invoiced',false) or q.invoice_sync_state in ('pending','uncertain') or q.payment_sync_state in ('pending','uncertain')
  on conflict(order_id) do nothing;
  update public.order_invoice_ledger l set legacy_operations=x.operations,
    legacy_unresolved=l.legacy_unresolved or coalesce(x.unresolved,false) or x.invoice_count>1
  from (select q.order_id,jsonb_agg(jsonb_build_object('invoice_id',q.zoho_invoice_id,'payment_id',q.zoho_payment_id,'invoice_state',q.invoice_sync_state,'payment_state',q.payment_sync_state,'invoice_claim_token',q.invoice_claim_token,'payment_claim_token',q.payment_claim_token,'superseded',q.superseded_at is not null)) as operations,
    bool_or((q.superseded_at is not null and (q.invoice_sync_state in ('pending','uncertain') or q.payment_sync_state in ('pending','uncertain'))) or (coalesce(q.zoho_status='invoiced',false) and q.zoho_invoice_id is null)) as unresolved,
    count(distinct q.zoho_invoice_id) as invoice_count from public.order_quotations q group by q.order_id) x where x.order_id=l.order_id;
  create function public.confirm_order_invoice_deposit(p_order uuid,p_invoice text,p_payment text,p_total integer,p_deposit integer,p_fingerprint text,p_actor uuid) returns void
  language plpgsql set search_path=public as $$
  declare o public.orders%rowtype;
  begin
    if not exists(select 1 from public.profiles where id=p_actor and role in ('admin','ops') and is_active) then raise exception 'operations access required'; end if;
    select * into o from public.orders where id=p_order for update;
    if not found or o.is_draft or o.current_status::text not in ('order_recorded','quotation_sent','deposit_received') or o.price_quoted_cents<>p_total or o.deposit_cents<>p_deposit or p_deposit<=0 or p_deposit>p_total then raise exception 'order changed'; end if;
    perform 1 from public.order_invoice_ledger l where l.order_id=p_order and l.invoice_id=p_invoice and l.payment_id=p_payment and p_invoice<>'' and p_payment<>'' and l.invoice_state='linked' and l.payment_state='linked' and l.verified_fingerprint=p_fingerprint and (l.document->>'totalCents')::integer=p_total for update;
    if not found then raise exception 'verified invoice and payment required'; end if;
    if o.current_status::text='deposit_received' then return; end if;
    if o.current_status::text='order_recorded' then insert into public.order_invoice_recovery_permits values(p_order,txid_current(),p_actor); end if;
    insert into public.order_status_events(order_id,status,note,created_by) values(p_order,'deposit_received','Verified current order invoice and existing deposit payment.',p_actor);
    delete from public.order_invoice_recovery_permits where order_id=p_order;
  end $$;
  revoke all on function public.confirm_order_invoice_deposit(uuid,text,text,integer,integer,text,uuid) from public;
  grant execute on function public.confirm_order_invoice_deposit(uuid,text,text,integer,integer,text,uuid) to service_role;`.execute(db);
}
export async function down(db: Kysely<unknown>) {
  await sql`drop function public.confirm_order_invoice_deposit(uuid,text,text,integer,integer,text,uuid); drop table public.order_invoice_audit; drop table public.order_invoice_ledger;`.execute(db);
}
