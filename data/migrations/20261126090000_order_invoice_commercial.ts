import { sql, type Kysely } from "kysely";
export async function up(db: Kysely<unknown>) {
  await sql`create table public.order_invoice_commercial (
    order_id uuid primary key references public.orders(id) on delete cascade,
    quotation_id uuid not null references public.order_quotations(id),
    invoice_id text not null, document jsonb not null,
    synced_fingerprint text, remote_fingerprint text, state text not null check(state in ('synced','updating','uncertain')),
    claim_token uuid, revision integer not null default 1,
    updated_by uuid not null references public.profiles(id), updated_at timestamptz not null default now()
  );
  alter table public.order_invoice_commercial enable row level security;
  create table public.order_invoice_commercial_events (
    id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders(id) on delete cascade,
    invoice_id text not null, action text not null, before_document jsonb, after_document jsonb not null,
    actor_id uuid not null references public.profiles(id), created_at timestamptz not null default now()
  );
  alter table public.order_invoice_commercial_events enable row level security;`.execute(db);
}
export async function down(db: Kysely<unknown>) {
  await sql`drop table public.order_invoice_commercial_events; drop table public.order_invoice_commercial;`.execute(db);
}
