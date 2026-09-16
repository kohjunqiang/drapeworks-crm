/** Explicit local-only provisioning; never imported by application/startup. */
import { promises as fs } from "node:fs";
import path from "node:path";
import { Kysely, PostgresDialect, sql } from "kysely";
import { FileMigrationProvider, Migrator } from "kysely/migration";
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("Pass the isolated local DATABASE_URL explicitly");
const url = new URL(connectionString);
if (url.hostname !== "127.0.0.1" || url.port !== "55439" || url.pathname !== "/drapeworks_priority_local") throw new Error("Refusing non-test destination");
const db = new Kysely<unknown>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString, ssl: false, max: 1 }) }) });
const skip = new Set([
  "20260903110000_import_germaine_order_shell", "20260903112000_import_dawn_order_shell", "20260903113000_import_isaac_order_shell",
  "20260903131000_exclude_shimin_repeat_appointment_conversion", "20260903132000_close_isaac_won",
]);
async function main() {
  const provider = new FileMigrationProvider({ fs, path, migrationFolder: path.join(process.cwd(), "data/migrations") });
  const migrator = new Migrator({ db, provider: { async getMigrations() {
    const migrations = await provider.getMigrations();
    for (const name of skip) if (migrations[name]) migrations[name] = { up: async () => {}, down: async () => {} };
    return migrations;
  } } });
  const result = await migrator.migrateToLatest();
  if (result.error) throw result.error;
  // This historical migration mixes a schema addition with a production-only repair.
  await sql`alter table lead_stage_events add column if not exists counts_as_appointment_conversion boolean not null default true`.execute(db);
  await sql`insert into auth.users(id,email) values ('00000000-0000-4000-8000-000000000099','priority@example.test') on conflict do nothing`.execute(db);
  await sql`update profiles set full_name='Local Priority Tester', is_presales_owner=true where id='00000000-0000-4000-8000-000000000099'`.execute(db);
  const cases = [
    ["A", "Move-In Within 2 Months", 55000, "High", 0],
    ["B", "Carpentry Completed", 150000, "High", 0],
    ["C", "Keys Collected", 150000, "Medium", 0],
    ["D", "Move-In Within 2 Months", 40000, "Low", 0],
    ["E", "Carpentry Completed", null, "High", 0],
    ["Overdue", "Pre-Keys", 50000, "Low", -2],
    ["Upcoming", "Move-In Within 2 Months", 200000, "High", 7],
    ["Unassessed", null, null, null, null],
  ] as const;
  for (const [label, stage, cents, quality, offset] of cases) {
    await sql`insert into leads(lead_ref,name,contact_channel,owner_id,lead_status,funnel_stage,first_initiated_at,renovation_buying_stage,latest_quote_cents,engagement_quality,next_action_date)
      values (${`PRIORITY-TEST-${label}`},${`Priority test ${label}`},'Other','00000000-0000-4000-8000-000000000099','Active','Qualify Lead',now(),${stage}::lead_buying_stage,${cents},${quality}::lead_engagement_quality,case when ${offset}::integer is null then null else (now() at time zone 'Asia/Singapore')::date + ${offset}::integer end)
      on conflict (lead_ref) do nothing`.execute(db);
  }
  console.log("Local schema ready; synthetic priority cases seeded (existing tester edits preserved).");
}
main().finally(() => db.destroy());
