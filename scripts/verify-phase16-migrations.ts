import "dotenv/config";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import { up as m1 } from "../data/migrations/202608281000_lead_enums";
import { up as m2 } from "../data/migrations/202608281100_lead_legacy_snapshot";
import { up as m3 } from "../data/migrations/202608281200_lead_new_columns";
import { up as m4 } from "../data/migrations/202608281300_lead_interactions";
import { up as m5 } from "../data/migrations/202608281400_lead_status_trigger";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  const local = /^postgres(?:ql)?:\/\/(?:[^@/]+@)?(?:localhost|127\.0\.0\.1)(?::|\/)/.test(connectionString);
  const db = new Kysely<unknown>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString, ssl: local ? false : { rejectUnauthorized: false }, max: 1 }) }) });
  await sql`begin`.execute(db);
  try {
    const alreadyApplied = (await sql<{ present: boolean }>`select to_regtype('lead_funnel_stage_legacy') is not null as present`.execute(db)).rows[0]?.present;
    if (!alreadyApplied) {
      for (const migration of [m1, m2, m3, m4, m5]) await migration(db);
    }
    const count = (await sql<{ count: number }>`select count(*)::int count from leads`.execute(db)).rows[0]?.count;
    if (count !== 244) throw new Error(`Expected 244 leads, found ${count}`);
    const quotes = (await sql<{ count: number }>`select count(*)::int count from leads where last_outcome='Quotation Sent'`.execute(db)).rows[0]?.count;
    if (quotes !== 22) throw new Error(`Expected 22 Quotation Sent outcomes, found ${quotes}`);
    const counters = await sql<{ unanswered_followups: number; count: number }>`select unanswered_followups,count(*)::int count from leads group by 1 order by 1`.execute(db);
    const encoded = counters.rows.map(row => `${row.unanswered_followups}:${row.count}`).join(",");
    if (encoded !== "0:116,1:11,2:117") throw new Error(`Unexpected counter distribution ${encoded}`);
    const presales = (await sql<{ count: number }>`select count(*)::int count from profiles where is_presales_owner`.execute(db)).rows[0]?.count;
    if (presales !== 1) throw new Error(`Expected one pre-sales owner, found ${presales}`);
    console.log(`All Phase 16 migration gates passed for ${count} leads; rolling back verification transaction.`);
  } finally {
    await sql`rollback`.execute(db);
    await db.destroy();
  }
}

main().catch(error => { console.error(error); process.exit(1); });
