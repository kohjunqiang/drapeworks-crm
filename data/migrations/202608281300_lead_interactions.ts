import { sql, type Kysely } from "kysely";
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`create table lead_interactions (id uuid primary key default gen_random_uuid(), lead_id uuid not null references leads(id) on delete restrict, occurred_at timestamptz not null, direction lead_direction, interaction_type interaction_type not null, note text, channel lead_contact_channel, created_by uuid references profiles(id), created_at timestamptz not null default now()); create index lead_interactions_lead_occurred_idx on lead_interactions(lead_id, occurred_at desc, created_at desc, id desc)`.execute(db);
  await sql`create table lead_stage_events (id uuid primary key default gen_random_uuid(), lead_id uuid not null references leads(id) on delete restrict, from_stage lead_funnel_stage, to_stage lead_funnel_stage not null, changed_at timestamptz not null, changed_by uuid references profiles(id), source text not null check(source in ('user','system')), created_at timestamptz not null default now()); create index lead_stage_events_lead_changed_idx on lead_stage_events(lead_id,changed_at)`.execute(db);
  await sql`alter table lead_interactions enable row level security; alter table lead_stage_events enable row level security; create policy lead_interactions_select_authenticated on lead_interactions for select to authenticated using(true); create policy lead_interactions_write_authenticated on lead_interactions for all to authenticated using(true) with check(true); create policy lead_stage_events_select_authenticated on lead_stage_events for select to authenticated using(true); create policy lead_stage_events_write_authenticated on lead_stage_events for all to authenticated using(true) with check(true)`.execute(db);
  await sql`
    create function refresh_lead_interaction_state(target_lead_id uuid) returns void language plpgsql as $$
    begin
      update leads l set
        unanswered_followups=(select count(*)::int from lead_interactions i where i.lead_id=target_lead_id and i.direction='Outbound' and i.interaction_type='Follow-Up' and i.occurred_at > coalesce((select max(r.occurred_at) from lead_interactions r where r.lead_id=target_lead_id and r.direction='Inbound'), '-infinity'::timestamptz)),
        last_message_by=(select i.direction from lead_interactions i where i.lead_id=target_lead_id and i.direction is not null order by i.occurred_at desc,i.created_at desc,i.id desc limit 1),
        last_contact_at=(select i.occurred_at from lead_interactions i where i.lead_id=target_lead_id and i.direction is not null order by i.occurred_at desc,i.created_at desc,i.id desc limit 1),
        last_customer_response_at=(select i.occurred_at from lead_interactions i where i.lead_id=target_lead_id and i.direction='Inbound' order by i.occurred_at desc,i.created_at desc,i.id desc limit 1)
      where l.id=target_lead_id;
    end $$;
    create function lead_interactions_refresh_lead() returns trigger language plpgsql as $$
    begin
      if tg_op='DELETE' then perform refresh_lead_interaction_state(old.lead_id);
      elsif tg_op='UPDATE' then perform refresh_lead_interaction_state(new.lead_id); if old.lead_id is distinct from new.lead_id then perform refresh_lead_interaction_state(old.lead_id); end if;
      else perform refresh_lead_interaction_state(new.lead_id); end if;
      return coalesce(new,old);
    end $$;
    create trigger lead_interactions_refresh_lead after insert or update or delete on lead_interactions for each row execute function lead_interactions_refresh_lead()
  `.execute(db);
  await sql`insert into lead_interactions(lead_id,occurred_at,direction,interaction_type,note,channel) select l.id,s.last_customer_response_at,'Inbound','Customer Message','Migrated customer response',l.contact_channel from leads l join lead_legacy_import s on s.lead_id=l.id where s.last_customer_response_at is not null`.execute(db);
  await sql`insert into lead_interactions(lead_id,occurred_at,direction,interaction_type,note,channel) select l.id, greatest(coalesce(s.last_contact_at,s.snapshot_at),coalesce(s.last_customer_response_at,'-infinity')+interval '1 second') + (g.n-1)*interval '1 second','Outbound','Follow-Up','Migrated — the spreadsheet recorded this lead as unresponsive',l.contact_channel from leads l join lead_legacy_import s on s.lead_id=l.id cross join lateral generate_series(1,case when s.lead_status::text='Unresponsive' then 2 when s.last_outcome::text='Follow-Up Sent' then 1 else 0 end) g(n)`.execute(db);
  await sql`insert into lead_interactions(lead_id,occurred_at,direction,interaction_type,note,channel) select l.id,s.last_contact_at,'Outbound','Reply','Migrated outbound contact',l.contact_channel from leads l join lead_legacy_import s on s.lead_id=l.id where s.last_contact_at is not null and (s.last_customer_response_at is null or s.last_contact_at>s.last_customer_response_at) and s.lead_status::text<>'Unresponsive' and s.last_outcome::text<>'Follow-Up Sent'`.execute(db);
  await sql`insert into lead_interactions(lead_id,occurred_at,direction,interaction_type,note,channel) select l.id,s.snapshot_at,null,'Note',concat_ws(E'\n',nullif(s.action_detail_override,''),nullif(s.buying_readiness,''),nullif(s.keys_status,''),nullif(s.expected_key_date,'')),l.contact_channel from leads l join lead_legacy_import s on s.lead_id=l.id where concat_ws('',s.action_detail_override,s.buying_readiness,s.keys_status,s.expected_key_date)<>''`.execute(db);
  await sql`insert into lead_stage_events(lead_id,from_stage,to_stage,changed_at,source) select l.id,null,l.funnel_stage,coalesce(l.last_contact_at,l.first_initiated_at,now()),'system' from leads l`.execute(db);
}
export async function down(db: Kysely<unknown>): Promise<void> { await sql`drop table lead_stage_events; drop table lead_interactions; drop function lead_interactions_refresh_lead(); drop function refresh_lead_interaction_state(uuid)`.execute(db); }
