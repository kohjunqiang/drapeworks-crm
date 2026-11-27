/** Local-only batch-edit QA fixture; never imported by application/startup. */
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("Pass the isolated local DATABASE_URL explicitly");
const url = new URL(connectionString);
if (url.hostname !== "127.0.0.1" || url.port !== "55439" || url.pathname !== "/drapeworks_priority_local") throw new Error("Refusing non-test destination");
const db = new Kysely<unknown>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString, ssl: false, max: 1 }) }) });

const TESTER = "00000000-0000-4000-8000-000000000099";
const COUNT = 30;

const stages = [
  "Qualify Lead", "Qualify Lead", "Qualify Lead", "Nurture Lead – Long Term", "Activate Lead – Short Term",
  "Book Appointment", "Attend Appointment", "Send Quotation", "Collect Deposit", "Decision Pending",
  "Lost", "Not Qualified",
];
const channels = ["Telegram", "WhatsApp", "Other"];
const sources = ["Telegram Group Buy", "SEM", "Organic", "Carousell", "Referral", "Existing Customer", "Other"];
const directions = ["Inbound", "Outbound"];
const products = ["Curtains / Blinds", "Mesh", "Both"];
const buyingStages = ["Pre-Keys", "Keys Collected", "3D / Design Completed", "Carpentry Completed", "Move-In Within 2 Months"];
const qualities = ["Low", "Medium", "High"];

async function main() {
  // Idempotent: lead_ref conflicts are skipped wholesale, so edits a tester
  // already made to a seeded row are never reset.
  for (let index = 1; index <= COUNT; index += 1) {
    const stage = stages[index % stages.length];
    const terminal = stage === "Lost" || stage === "Not Qualified" || stage === "Won";
    // Terminal rows must carry a reason — the BEFORE INSERT trigger rejects a
    // null closure_reason on Lost/Not Qualified/Won leads.
    await sql`
      insert into leads (
        lead_ref, name, mobile, development, contact_channel, source, inbound_outbound,
        primary_product, owner_id, assigned_consultant_id, lead_status, funnel_stage,
        closure_reason, last_outcome, first_initiated_at, next_action_date, move_in_date,
        action_detail, interaction_summary, historical_summary, latest_quote_note,
        quotation_breakdown, keys_collected, renovation_buying_stage, engagement_quality,
        latest_quote_cents
      ) values (
        ${`BULK-QA-${String(index).padStart(3, "0")}`},
        ${`Bulk QA Lead ${index}`},
        ${`9${String(1000000 + index).slice(0, 7)}`},
        ${`QA Residences Block ${index}`},
        ${channels[index % channels.length]}::lead_contact_channel,
        ${sources[index % sources.length]}::lead_source,
        ${directions[index % directions.length]}::lead_direction,
        ${products[index % products.length]}::lead_primary_product,
        ${TESTER}::uuid, ${TESTER}::uuid,
        'Active',
        ${stage}::lead_funnel_stage,
        ${terminal ? "Other" : null}::lead_closure_reason,
        ${index % 3 === 0 ? "Awaiting Customer" : null}::lead_outcome,
        now() - (${index}::integer || ' days')::interval,
        (now() at time zone 'Asia/Singapore')::date + (${index % 10}::integer - 4),
        ${index % 4 === 0 ? sql`(now() at time zone 'Asia/Singapore')::date + 60` : sql`null`},
        ${`Follow up on batch case ${index}`},
        ${`Synthetic summary ${index}`},
        ${index % 5 === 0 ? `Historical note ${index}` : null},
        ${index % 6 === 0 ? `Quote note ${index}` : null},
        ${index % 6 === 0 ? `2 curtains, 1 mesh — case ${index}` : null},
        ${index % 2 === 0},
        ${buyingStages[index % buyingStages.length]}::lead_buying_stage,
        ${qualities[index % qualities.length]}::lead_engagement_quality,
        ${(index % 7) * 25000 + 50000}
      )
      on conflict (lead_ref) do nothing`.execute(db);
  }
  console.log(`${COUNT} synthetic BULK-QA leads ensured (existing tester edits preserved).`);
}
main().finally(() => db.destroy());
