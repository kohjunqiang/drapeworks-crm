import assert from "node:assert/strict";
import { Kysely, PostgresDialect, sql } from "kysely";
import { up, down } from "../data/migrations/20260915160000_lead_priority";
import { Pool } from "pg";
import { BUYING_STAGES, ENGAGEMENT_QUALITIES } from "../src/lib/leads/priority";
import { calculatePriority } from "../src/lib/leads/__fixtures__/priority-reference";
const value = process.env.DATABASE_URL;
if (!value) throw new Error("Explicit local DATABASE_URL required");
const url = new URL(value);
if (url.hostname !== "127.0.0.1" || url.port !== "55439" || url.pathname !== "/drapeworks_priority_local") throw new Error("Refusing non-test database");
const pool = new Pool({connectionString:value,ssl:false,max:1});
async function main() {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const before = (await client.query("select * from leads where lead_ref='PRIORITY-TEST-B' for update")).rows[0];
    assert(before, "Seed the local fixture first");
    const historyBefore = (await client.query("select count(*) from lead_stage_events where lead_id=$1",[before.id])).rows[0].count;
    let cases = 0;
    for (const stage of [...BUYING_STAGES,null]) for (const quality of [...ENGAGEMENT_QUALITIES,null]) for (const cents of [null,0,59999,60000,89999,90000,119999,120000,179999,180000,100000000]) {
      const row = (await client.query("update leads set renovation_buying_stage=$1, engagement_quality=$2, latest_quote_cents=$3 where id=$4 returning *",[stage,quality,cents,before.id])).rows[0];
      const expected = calculatePriority({renovation_buying_stage:stage,engagement_quality:quality,latest_quote_cents:cents});
      for (const key of ["readiness_score","commercial_value_score","engagement_quality_score","priority_score","priority_class"] as const) assert.equal(row[key],expected[key],`${stage}/${quality}/${cents}/${key}`);
      for (const key of ["funnel_stage","lead_status","last_outcome","unanswered_followups","next_action_date","owner_id","interaction_summary"]) assert.deepEqual(row[key],before[key],`Unchanged workflow ${key}`);
      cases++;
    }
    assert.equal((await client.query("select count(*) from lead_stage_events where lead_id=$1",[before.id])).rows[0].count,historyBefore);
    await client.query("savepoint invalid");
    await assert.rejects(client.query("update leads set engagement_quality='Very High' where id=$1",[before.id]));
    await client.query("rollback to savepoint invalid");
    await assert.rejects(client.query("update leads set priority_score=100 where id=$1",[before.id]));
    await client.query("rollback to savepoint invalid");
    console.log(`${cases} SQL/application parity cases passed; workflow/history preserved; invalid manual values and score overrides rejected. All verification changes rolled back.`);
  } finally { await client.query("rollback"); client.release(); await pool.end(); }
}
async function verifyMigration() {
  const db = new Kysely<unknown>({dialect:new PostgresDialect({pool:new Pool({connectionString:value,ssl:false,max:1})})});
  const rollback = new Error("intentional rollback");
  try {
    await db.transaction().execute(async trx => {
      const originalFields = (await sql`select to_jsonb(leads) - array['renovation_buying_stage','engagement_quality','readiness_score','commercial_value_score','engagement_quality_score','priority_score','priority_class'] as row from leads order by id`.execute(trx)).rows;
      const originalHistory = (await sql`select to_jsonb(lead_stage_events) as row from lead_stage_events order by id`.execute(trx)).rows;
      await down(trx);
      const before = (await sql`select to_jsonb(leads) as row from leads order by id`.execute(trx)).rows;
      assert.deepEqual(before, originalFields, "Down preserves every original lead field, including quotation and timestamps");
      assert.deepEqual((await sql`select to_jsonb(lead_stage_events) as row from lead_stage_events order by id`.execute(trx)).rows, originalHistory, "Down preserves complete stage history");
      const remaining = await sql<{count:string}>`select count(*) from information_schema.columns where table_schema='public' and table_name='leads' and column_name in ('renovation_buying_stage','engagement_quality','readiness_score','commercial_value_score','engagement_quality_score','priority_score','priority_class')`.execute(trx);
      assert.equal(remaining.rows[0].count, "0", "Down removes all seven priority columns");
      const enums = await sql<{count:string}>`select count(*) from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' and t.typname in ('lead_buying_stage','lead_engagement_quality')`.execute(trx);
      assert.equal(enums.rows[0].count, "0", "Down removes both priority enums");
      const history = (await sql`select count(*) as count from lead_stage_events`.execute(trx)).rows;
      await up(trx);
      const after = (await sql`select to_jsonb(leads) - array['renovation_buying_stage','engagement_quality','readiness_score','commercial_value_score','engagement_quality_score','priority_score','priority_class'] as row from leads order by id`.execute(trx)).rows;
      assert.deepEqual(after,before,"Migration preserves every original lead field and timestamp");
      assert.deepEqual((await sql`select count(*) as count from lead_stage_events`.execute(trx)).rows,history);
      const scored = await sql<{count:string}>`select count(*) from leads where priority_score is not null or priority_class is not null`.execute(trx);
      assert.equal(scored.rows[0].count,"0","Legacy leads remain Pending");
      throw rollback;
    });
  } catch(error) { if(error !== rollback) throw error; }
  finally { await db.destroy(); }
  console.log("Migration up/down verified: existing fields, timestamps and history preserved; legacy leads Pending. Rolled back.");
}
main().then(verifyMigration);
