import "dotenv/config";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import { up } from "../data/migrations/20260831120000_lead_import_baselines";

async function main() {
  const db = new Kysely<unknown>({ dialect: new PostgresDialect({pool:new Pool({connectionString:process.env.DATABASE_URL,max:1,ssl:{rejectUnauthorized:false}})}) });
  try {
    await db.transaction().execute(async trx => {
      await up(trx);
      await sql`
        do $$
        declare target uuid; n integer; d timestamptz;
        begin
          insert into leads(lead_ref,name,contact_channel) values ('sync-verification-'||gen_random_uuid(),'Rollback-only verification','Other') returning id into target;
          insert into lead_interactions(lead_id,occurred_at,direction,interaction_type) values(target,now()-interval '2 days','Outbound','Follow-Up');
          select unanswered_followups into n from leads where id=target;
          if n<>1 then raise exception 'Existing no-baseline behavior failed'; end if;
          insert into lead_import_baselines values(target,now()-interval '1 hour',3,now()-interval '1 day',null,'Outbound');
          insert into lead_interactions(lead_id,occurred_at,interaction_type,note) values(target,now(),'Note','Test');
          select unanswered_followups,last_contact_at into n,d from leads where id=target;
          if n<>3 or d is distinct from now()-interval '1 day' then raise exception 'Note destroyed baseline'; end if;
          insert into lead_interactions(lead_id,occurred_at,direction,interaction_type) values(target,now()-interval '30 minutes','Outbound','Follow-Up');
          select unanswered_followups into n from leads where id=target;
          if n<>4 then raise exception 'Follow-up did not increment baseline'; end if;
          insert into lead_interactions(lead_id,occurred_at,direction,interaction_type) values(target,now()-interval '20 minutes','Inbound','Customer Message');
          select unanswered_followups into n from leads where id=target;
          if n<>0 then raise exception 'Customer response did not reset baseline'; end if;
          insert into lead_interactions(lead_id,occurred_at,direction,interaction_type) values(target,now()-interval '10 minutes','Outbound','Follow-Up');
          select unanswered_followups into n from leads where id=target;
          if n<>1 then raise exception 'Post-response count incorrect'; end if;
          if has_table_privilege('anon','lead_import_baselines','SELECT')
             or has_table_privilege('authenticated','lead_import_baselines','UPDATE')
             or has_table_privilege('authenticated','lead_import_baselines','INSERT')
          then raise exception 'Unexpected baseline permissions'; end if;
        end $$;
      `.execute(trx);
      throw new Error("VERIFIED_ROLLBACK");
    });
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "VERIFIED_ROLLBACK") throw error;
    console.log("PASS: baseline persistence, future follow-up increment, inbound reset, old behavior and permissions. All test data/schema rolled back.");
  } finally { await db.destroy(); }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
