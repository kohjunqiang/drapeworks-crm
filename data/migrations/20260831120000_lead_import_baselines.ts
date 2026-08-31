import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table lead_import_baselines (
      lead_id uuid primary key references leads(id) on delete restrict,
      as_of timestamptz not null,
      unanswered_followups integer not null check (unanswered_followups >= 0),
      last_contact_at timestamptz,
      last_customer_response_at timestamptz,
      last_message_by lead_direction
    );
    alter table lead_import_baselines enable row level security;
    revoke all on lead_import_baselines from anon, authenticated;
    grant select on lead_import_baselines to authenticated;
    create policy lead_import_baselines_read on lead_import_baselines
      for select to authenticated using (true);
    create or replace function refresh_lead_interaction_state(target_lead_id uuid)
    returns void language plpgsql as $$
    declare
      baseline lead_import_baselines%rowtype;
      cutoff timestamptz;
      response_at timestamptz;
      contact_at timestamptz;
      contact_direction lead_direction;
      followups integer;
    begin
      select * into baseline from lead_import_baselines where lead_id=target_lead_id;
      cutoff := coalesce(baseline.as_of, '-infinity'::timestamptz);
      select max(occurred_at) into response_at from lead_interactions
        where lead_id=target_lead_id and direction='Inbound' and occurred_at > cutoff;
      select occurred_at, direction into contact_at, contact_direction
        from lead_interactions where lead_id=target_lead_id
        and direction is not null and occurred_at > cutoff
        order by occurred_at desc,created_at desc,id desc limit 1;
      select count(*)::int into followups from lead_interactions
        where lead_id=target_lead_id and direction='Outbound'
        and interaction_type='Follow-Up'
        and occurred_at > greatest(cutoff, coalesce(response_at, '-infinity'::timestamptz));
      update leads set
        unanswered_followups=followups + case when response_at is null then coalesce(baseline.unanswered_followups,0) else 0 end,
        last_message_by=coalesce(contact_direction,baseline.last_message_by),
        last_contact_at=coalesce(contact_at,baseline.last_contact_at),
        last_customer_response_at=coalesce(response_at,baseline.last_customer_response_at)
        where id=target_lead_id;
    end $$;
  `.execute(db);
}

export async function down(): Promise<void> {
  throw new Error("Import baselines preserve authoritative lead state; rollback requires an explicit data migration.");
}
