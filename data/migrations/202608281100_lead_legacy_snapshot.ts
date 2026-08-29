import { sql, type Kysely } from "kysely";
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`create table lead_legacy_import (lead_id uuid primary key references leads(id) on delete restrict, funnel_stage lead_funnel_stage_legacy not null, lead_status lead_status_legacy not null, last_outcome lead_outcome_legacy, action_detail_override text, action_date date, buying_readiness text, keys_status text, expected_key_date text, owner_id uuid, first_initiated_at timestamptz, last_contact_at timestamptz, last_customer_response_at timestamptz, snapshot_at timestamptz not null default now())`.execute(db);
  await sql`insert into lead_legacy_import (lead_id,funnel_stage,lead_status,last_outcome,action_detail_override,action_date,buying_readiness,keys_status,expected_key_date,owner_id,first_initiated_at,last_contact_at,last_customer_response_at) select id,funnel_stage,lead_status,last_outcome,action_detail_override,action_date,buying_readiness,keys_status,expected_key_date,owner_id,first_initiated_at,last_contact_at,last_customer_response_at from leads`.execute(db);
  await sql`alter table lead_legacy_import enable row level security`.execute(db);
  await sql`create policy lead_legacy_select_authenticated on lead_legacy_import for select to authenticated using (true)`.execute(db);
}
export async function down(db: Kysely<unknown>): Promise<void> { await sql`drop table lead_legacy_import`.execute(db); }
