import "dotenv/config";
import ExcelJS from "exceljs";
import { Pool, types } from "pg";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { FUNNEL_STAGES, LEAD_OUTCOMES, CONTACT_CHANNELS, LEAD_SOURCES, PRIMARY_PRODUCTS, CLOSURE_REASONS } from "../src/lib/leads/funnel-types";

// Defaults to a read-only dry run. No rows are deleted and no backups are made.
const filename = process.argv[2];
const apply = process.argv.includes("--apply");
types.setTypeParser(1082, value => value); // DATE is a calendar date, not an instant.
if (!filename) throw new Error("Pass the source workbook path");
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, ssl: { rejectUnauthorized: false } });
const text = (cell: ExcelJS.Cell) => cell.text.trim();
const date = (cell: ExcelJS.Cell, timestamp = false): string | null => {
  const value = cell.value;
  if (value === null || value === "") return null;
  if (!(value instanceof Date)) throw new Error(`Row ${cell.row} ${cell.address}: expected an Excel date`);
  // Excel stores Singapore wall-clock values; ExcelJS reads them as UTC.
  return timestamp ? new Date(value.getTime() - 8 * 3600000).toISOString() : value.toISOString().slice(0, 10);
};
// Database rows include dynamically selected columns; identifiers below are
// exclusively program-owned, never supplied by workbook contents.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RecordData = Record<string, any>;
async function main() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filename);
  const sheet = workbook.getWorksheet("Leads");
  if (!sheet || text(sheet.getCell("A4")) !== "Lead ID" || text(sheet.getCell("AG4")) !== "Unanswered Follow-Up Attempts") throw new Error("Unexpected workbook structure");
  const digest = createHash("sha256").update(await readFile(filename)).digest("hex").slice(0, 16);
  const client = await pool.connect();
  try {
    await client.query("begin");
    if (apply) await client.query("set local lock_timeout = '5s'");
    if (apply) await client.query("lock table leads in share row exclusive mode");
    const existing: RecordData[] = (await client.query("select * from leads")).rows;
    const baselineIds = new Set((await client.query("select lead_id from lead_import_baselines")).rows.map(r=>r.lead_id));
    const profiles: RecordData[] = (await client.query("select id, full_name, is_presales_owner from profiles where is_active")).rows;
    const presales = profiles.find(p => p.is_presales_owner)?.id;
    const plans: { row: number; current?: RecordData; patch: RecordData; appointment: string | null; followups: number | null }[] = [];
    const issues: string[] = [], skipped: number[] = [];
    const seen = new Set<string>();
    const enumValue = (r: ExcelJS.Row, col: number, allowed: readonly string[]) => {
      const value = text(r.getCell(col));
      if (value && !allowed.includes(value)) throw new Error(`Row ${r.number} column ${col}: unsupported value ${value}`);
      return value || null;
    };
    sheet.eachRow((r, n) => {
      if (n < 5 || !text(r.getCell(1))) return;
      const ref = text(r.getCell(1)), name = text(r.getCell(2)), stage = text(r.getCell(6));
      if (!FUNNEL_STAGES.includes(stage as never)) { skipped.push(n); return; }
      let matches = ["TG", "WA", "WA-SEM", "Carousell"].includes(ref) ? [] : existing.filter(l => l.lead_ref === ref);
      if (!matches.length) matches = existing.filter(l => l.source_ref === ref && l.name.trim() === name);
      if (!matches.length && !["TG", "WA", "WA-SEM", "Carousell"].includes(ref)) matches = existing.filter(l => l.source_ref === ref);
      if (!matches.length && text(r.getCell(34))) matches = existing.filter(l => l.telegram_chat_id === text(r.getCell(34)) && (!text(r.getCell(21)) || l.contact_channel === text(r.getCell(21))));
      // Changed placeholder references/names require corroborating initiation
      // timestamp and channel, never a name-only fuzzy match.
      if (!matches.length) matches = existing.filter(l =>
        date(r.getCell(4), true) === l.first_initiated_at?.toISOString() &&
        text(r.getCell(21)) === l.contact_channel &&
        (l.name.trim() === name || name.startsWith(l.name.trim() + " (")));
      if (matches.length > 1) { issues.push(`Row ${n}: ambiguous identity`); return; }
      const current = matches[0];
      if (current?.is_archived) { issues.push(`Row ${n}: matches archived lead`); return; }
      const key = current?.id ?? ref + "|" + name;
      if (seen.has(key)) { issues.push(`Row ${n}: duplicate source lead`); return; }
      seen.add(key);
      if (!current && !name) { issues.push(`Row ${n}: new lead without name`); return; }
      const patch: RecordData = { funnel_stage: stage };
      if (name) patch.name = name;
      const direct = { mobile: 25, development: 24, interaction_summary: 13, historical_summary: 35, action_detail: 10, quotation_breakdown: 31, telegram_chat_id: 34 };
      for (const [field, col] of Object.entries(direct)) if (text(r.getCell(col))) patch[field] = text(r.getCell(col));
      if (current?.historical_summary && patch.historical_summary && !current.historical_summary.includes(patch.historical_summary)) patch.historical_summary = current.historical_summary + "\n" + patch.historical_summary;
      else if (current?.historical_summary && patch.historical_summary) patch.historical_summary = current.historical_summary;
      for (const [field, col, allowed] of [
        ["last_outcome", 8, LEAD_OUTCOMES], ["contact_channel", 21, CONTACT_CHANNELS], ["source", 22, LEAD_SOURCES], ["primary_product", 23, PRIMARY_PRODUCTS], ["closure_reason", 32, CLOSURE_REASONS],
      ] as const) { const value = enumValue(r, col, allowed); if (value) patch[field] = value; }
      const direction = enumValue(r, 3, ["Inbound", "Outbound"]);
      if (direction) patch.inbound_outbound = direction;
      const lastBy = enumValue(r, 20, ["Customer", "Us"]);
      if (lastBy) patch.last_message_by = lastBy === "Customer" ? "Inbound" : "Outbound";
      const keys = enumValue(r, 16, ["Yes", "No"]);
      if (keys) patch.keys_collected = keys === "Yes";
      for (const [field, col, timestamp] of [
        ["first_initiated_at",4,true], ["last_contact_at",5,true], ["next_action_date",11,false], ["move_in_date",17,false], ["last_customer_response_at",19,true], ["quotation_sent_at",29,true],
      ] as const) { const value = date(r.getCell(col), timestamp); if (value) patch[field] = value; }
      const quoteValue = r.getCell(14).value;
      const quote = quoteValue && typeof quoteValue === "object" && "result" in quoteValue ? quoteValue.result : quoteValue;
      if (quote !== null && quote !== "") {
        if (typeof quote !== "number" || quote < 0) throw new Error(`Row ${n}: invalid quote`);
        patch.latest_quote_cents = Math.round(quote * 100);
      }
      const consultant = text(r.getCell(26));
      if (consultant) {
        const owners = profiles.filter(p => p.full_name?.toLowerCase() === consultant.toLowerCase() || p.full_name?.toLowerCase().startsWith(consultant.toLowerCase() + "."));
        if (owners.length !== 1) { issues.push(`Row ${n}: unresolved consultant ${consultant}`); return; }
        patch.assigned_consultant_id = owners[0].id;
        patch.owner_id = owners[0].id;
      } else if (!current) patch.owner_id = presales ?? null;
      if (!current) {
        const uniqueRef = !existing.some(l => l.lead_ref === ref) && !["TG", "WA", "WA-SEM", "Carousell"].includes(ref);
        patch.lead_ref = uniqueRef ? ref : ref + "-sync-" + createHash("sha256").update(ref + "|" + name).digest("hex").slice(0, 10);
        patch.source_ref = ref;
        patch.contact_channel ??= ref.startsWith("TG") ? "Telegram" : ref.startsWith("WA") ? "WhatsApp" : "Other";
      }
      if (["Lost", "Not Qualified"].includes(stage) && !patch.closure_reason && !current?.closure_reason && (!current || current.funnel_stage !== stage)) patch.closure_reason = "Other";
      const attempts = r.getCell(33).value;
      if (attempts !== null && (typeof attempts !== "number" || !Number.isInteger(attempts) || attempts < 0)) throw new Error(`Row ${n}: invalid follow-up count`);
      if (typeof attempts === "number") patch.unanswered_followups = attempts;
      const appointment = date(r.getCell(27), true);
      if (appointment) {
        // Preserve imported scheduling data without creating a calendar booking.
        const note = "Workbook appointment date/time (Singapore): " + new Date(new Date(appointment).getTime() + 8 * 3600000).toISOString().slice(0,16).replace("T"," ");
        const summary = patch.historical_summary ?? current?.historical_summary ?? "";
        if (!summary.includes(note)) patch.historical_summary = [summary, note].filter(Boolean).join("\n");
      }
      plans.push({ row:n, current, patch, appointment: date(r.getCell(27), true), followups: typeof attempts === "number" ? attempts : null });
    });
    const changes: Record<string, number> = {};
    const same = (a: unknown, b: unknown) => a instanceof Date ? (typeof b === "string" && b.length === 10 ? a.toISOString().slice(0, 10) === b : a.toISOString() === b) : a === b;
    for (const plan of plans) for (const [key,value] of Object.entries(plan.patch)) if (!same(plan.current?.[key], value)) changes[key] = (changes[key] ?? 0) + 1;
    console.log(JSON.stringify({ mode: apply ? "APPLY" : "DRY RUN", digest, workbookLeads: plans.length, matched: plans.filter(p=>p.current).length, new: plans.filter(p=>!p.current).length, skippedNonLeadRows:skipped, issues, fieldsChanged:changes, appointmentRows: plans.filter(p=>p.appointment).map(p=>p.row), followupConflicts: plans.filter(p=>p.current && p.followups !== null && p.current.unanswered_followups !== p.followups).map(p=>p.row), unmatchedExisting: existing.filter(l=>!l.is_archived && !plans.some(p=>p.current?.id===l.id)).length }, null, 2));
    if (issues.length) throw new Error("Sync blocked by validation issues; no changes made");
    if (!apply) { await client.query("rollback"); return; }
    let inserted = 0, updated = 0, unchanged = 0;
    const verified: { id: string; patch: RecordData }[] = [];
    for (const plan of plans) {
      const { current, patch } = plan;
      const changed = Object.entries(patch).some(([key,value]) => !same(current?.[key],value));
      if (!changed && current && baselineIds.has(current.id)) { unchanged++; continue; }
      let id = current?.id as string | undefined;
      if (!id) {
        const columns = Object.keys(patch);
        const result = await client.query(`insert into leads (${columns.map(c=>'"'+c+'"').join(",")}) values (${columns.map((_,i)=>"$"+(i+1)).join(",")}) returning id`, Object.values(patch));
        id = result.rows[0].id;
        inserted++;
      } else updated++;
      const snapshot = { ...current, ...patch };
      await client.query(`insert into lead_import_baselines
        (lead_id,as_of,unanswered_followups,last_contact_at,last_customer_response_at,last_message_by)
        values ($1,now(),$2,$3,$4,$5)
        on conflict (lead_id) do update set as_of=excluded.as_of,
        unanswered_followups=excluded.unanswered_followups,last_contact_at=excluded.last_contact_at,
        last_customer_response_at=excluded.last_customer_response_at,last_message_by=excluded.last_message_by`,
        [id,snapshot.unanswered_followups ?? 0,snapshot.last_contact_at ?? null,snapshot.last_customer_response_at ?? null,snapshot.last_message_by ?? null]);
      await client.query("insert into lead_interactions (lead_id,occurred_at,interaction_type,note,channel) values ($1,now(),'Note',$2,$3)", [id, `Workbook sync ${digest}, Leads row ${plan.row}. Imported latest worksheet values; historical interactions retained.`, patch.contact_channel ?? current?.contact_channel ?? "Other"]);
      // Interaction insertion refreshes rollups. Restore the imported snapshot
      // (and unchanged CRM values) after that trigger, without fabricating messages.
      const update = {
        ...(current ? Object.fromEntries(["unanswered_followups","last_message_by","last_contact_at","last_customer_response_at"].map(key=>[key,current[key]])) : {}),
        ...patch, updated_at: new Date(),
      };
      const columns = Object.keys(update);
      await client.query(`update leads set ${columns.map((c,i)=>'"'+c+'"=$'+(i+1)).join(",")} where id=$${columns.length+1}`, [...Object.values(update), id]);
      if (!current || current.funnel_stage !== patch.funnel_stage) await client.query("insert into lead_stage_events (lead_id,from_stage,to_stage,changed_at,source) values ($1,$2,$3,now(),'system')",[id,current?.funnel_stage ?? null,patch.funnel_stage]);
      verified.push({id:id!,patch});
    }
    for (const {id,patch} of verified) {
      await client.query("select refresh_lead_interaction_state($1)",[id]);
      const row = (await client.query("select * from leads where id=$1",[id])).rows[0];
      for (const [key,value] of Object.entries(patch)) if (!same(row[key],value)) throw new Error(`Verification failed for field ${key}; rolling back`);
    }
    await client.query("commit");
    console.log(JSON.stringify({committed:true,inserted,updated,unchanged,verified:verified.length}));
  } catch (error) { await client.query("rollback"); throw error; }
  finally { client.release(); await pool.end(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
