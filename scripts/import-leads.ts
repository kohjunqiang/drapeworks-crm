// scripts/import-leads.ts
//
// One-off import of the leads spreadsheet. Idempotent on lead_ref, so it can
// be re-run after a correction in the sheet.
//
// Deliberately NOT a migration: migrations are committed to git and this file
// carries 244 real customer names and 98 mobile numbers.
//
// Usage: npm run leads:import -- "02 Leads Management & Appt.xlsx"

import "dotenv/config";
import ExcelJS from "exceljs";
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";

import type { DB } from "../src/lib/db/schema";
import { toSgDate } from "../src/lib/leads/sg-date";

// NOT `import { db } from "@/lib/db/kysely"`. That module starts with
// `import "server-only"`, which throws outside a React Server Component — this
// is a plain Node script. data/migrate.ts builds its own instance for the same
// reason; follow that pattern.
const db = new Kysely<DB>({
  dialect: new PostgresDialect({
    pool: new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 1,
      ssl: { rejectUnauthorized: false },
    }),
  }),
});

const HEADER_ROW = 4; // rows 1–3 are the title, a note and usage instructions
const FIRST_DATA_ROW = 5;
const LAST_DATA_ROW = 250;

// 1-indexed column positions, from the header row.
const COL = {
  leadId: 1, customer: 2, initiator: 3, firstInitiated: 4, lastContact: 5,
  funnelStage: 6, leadStatus: 7, lastOutcome: 8, overrideDetail: 10,
  actionDate: 12, interactionSummary: 15, latestQuote: 16, buyingReadiness: 17,
  keysStatus: 18, expectedKeyDate: 19, lastCustomerResponse: 20,
  telegramChatId: 21, historicalSummary: 22, development: 27, mobile: 28,
} as const;

/** exceljs wraps formula cells as { formula, result }. Unwrap to the value. */
function cellValue(row: ExcelJS.Row, col: number): unknown {
  const value = row.getCell(col).value;
  if (value && typeof value === "object" && "result" in value) {
    return (value as { result: unknown }).result;
  }
  if (value && typeof value === "object" && "richText" in value) {
    return (value as ExcelJS.CellRichTextValue).richText.map((t) => t.text).join("");
  }
  return value;
}

function clean(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  // '-' occurs exactly once in the sheet, in the Customer column of row 118.
  return text === "" || text === "-" ? null : text;
}

/** Singapore is UTC+8 with no DST, so one constant covers every timestamp. */
const SG_OFFSET_MS = 8 * 60 * 60 * 1000;

/**
 * 168 date cells in this sheet carry number_format 'General', so they arrive as
 * raw Excel serials (46087) rather than dates. Parsed as text they become
 * Invalid Date -> null, which silently disables the 90-day stale rule for the
 * 50 leads whose Last Customer Response Date is stored that way.
 *
 * The epoch is 1899-12-30, not 1900-01-01: Excel deliberately reproduces a
 * Lotus 1-2-3 bug that treats 1900 as a leap year.
 *
 * The −8h is the important part. Excel stores no timezone, and both the serial
 * arithmetic and ExcelJS's own Date values treat the stored value as UTC — but
 * these are Alan's local wall-clock times. 199 of the 516 datetimes in the
 * sheet fall at hour >= 16, so read as UTC they land on the NEXT Singapore
 * calendar day. That is 56 rows of Last Customer Response Date shifting the
 * 90-day stale boundary by a day, and 185 rows showing a last-contact time
 * eight hours early on the lead detail screen.
 */
function asTimestamp(value: unknown): Date | null {
  if (value instanceof Date) {
    return new Date(value.getTime() - SG_OFFSET_MS);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(Date.UTC(1899, 11, 30) + value * 86_400_000 - SG_OFFSET_MS);
  }
  const text = clean(value);
  if (!text) return null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function asSgDate(value: unknown): string | null {
  const ts = asTimestamp(value);
  return ts ? toSgDate(ts) : null;
}

/**
 * 'Latest Quote' is numeric on 52 rows and free text on two:
 *   row 236  '688 Essential Night --> top $135 for Signature Night'
 *   row 237  '780 --> 660 after 15%'
 * Number() on those yields NaN and the integer insert throws mid-run.
 *
 * The text is stored verbatim and the amount is left NULL. A leading-number
 * heuristic looks helpful and is wrong on both rows: it takes 780 where the
 * current quote is 660, and 688 where it is arguably 823. Both leads are
 * queue-visible, so a wrong figure would feed the pipeline total looking
 * entirely authoritative — and once Task 26 deletes this script and its
 * console output, nothing would ever flag it. For two rows, a human reading
 * the note beats a guess.
 */
function parseQuote(value: unknown): { cents: number | null; note: string | null } {
  if (typeof value === "number") return { cents: Math.round(value * 100), note: null };
  const text = clean(value);
  return text ? { cents: null, note: text } : { cents: null, note: null };
}

function sourceFromRef(ref: string): "telegram" | "whatsapp" | "manual" {
  if (ref.startsWith("TG")) return "telegram";
  if (ref.startsWith("WA")) return "whatsapp";
  return "manual";
}

async function main() {
  const path = process.argv[2] ?? "02 Leads Management & Appt.xlsx";
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const sheet = wb.getWorksheet("Leads");
  if (!sheet) throw new Error(`No 'Leads' sheet in ${path}`);
  if (clean(cellValue(sheet.getRow(HEADER_ROW), COL.leadId)) !== "Lead ID") {
    throw new Error(`Row ${HEADER_ROW} is not the header row — the sheet has shifted`);
  }

  // Every lead in the sheet is Alan's. Fail loudly rather than importing 244
  // ownerless rows that then need a manual repair pass.
  const owner = await db
    .selectFrom("profiles")
    .select(["id", "full_name"])
    .where("full_name", "ilike", "%Alan%")
    .executeTakeFirst();
  if (!owner) {
    throw new Error(
      "No profile matching 'Alan' — create the user before importing, or the 244 leads land ownerless.",
    );
  }

  const seenRefs = new Set<string>();
  const notes: string[] = [];
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (let rowNumber = FIRST_DATA_ROW; rowNumber <= LAST_DATA_ROW; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const sourceRef = clean(cellValue(row, COL.leadId));

    // The two rows this actually skips are the blanks at 248 and 249 —
    // LAST_DATA_ROW already excludes the trailer. The prefix guard is
    // belt-and-braces for the trailer itself: row 251 is an operator
    // instruction, 253 a TODAY() helper whose first two cells are dates (so an
    // emptiness check lets it through as a lead) and 254 a counter. If anyone
    // ever raises LAST_DATA_ROW, this is what stops them importing furniture.
    if (!sourceRef || !/^(TG|WA)/.test(sourceRef)) {
      skipped += 1;
      continue;
    }

    // Ten rows carry a bare 'TG', 'WA' or 'WA-SEM'. Keyed on the raw value the
    // unique index fails and the upsert overwrites the wrong lead.
    let leadRef = sourceRef;
    if (seenRefs.has(leadRef) || !/^(TG|WA)-.+/.test(sourceRef)) {
      leadRef = `${sourceRef}-row${rowNumber}`;
      notes.push(`row ${rowNumber}: ref '${sourceRef}' -> '${leadRef}'`);
    }
    seenRefs.add(leadRef);

    // Rows 118 and 143 have no name; both are ghosted Not Qualified leads that
    // still carry an interaction summary. name is NOT NULL, so fall back to the
    // reference — dropping them would lose two real conversations and put the
    // final count at 242.
    let name = clean(cellValue(row, COL.customer));
    if (!name) {
      name = leadRef;
      notes.push(`row ${rowNumber}: no customer name, using '${leadRef}'`);
    }

    const quote = parseQuote(cellValue(row, COL.latestQuote));
    if (quote.note) notes.push(`row ${rowNumber}: quote text '${quote.note}'`);

    const values = {
      lead_ref: leadRef,
      source_ref: sourceRef,
      source: sourceFromRef(sourceRef),
      name,
      mobile: clean(cellValue(row, COL.mobile)),
      development: clean(cellValue(row, COL.development)),
      initiator: clean(cellValue(row, COL.initiator)) as "Customer" | "Us" | null,
      funnel_stage: clean(cellValue(row, COL.funnelStage)) ?? "New Lead",
      lead_status: clean(cellValue(row, COL.leadStatus)) ?? "Active",
      last_outcome: clean(cellValue(row, COL.lastOutcome)),
      action_detail_override: clean(cellValue(row, COL.overrideDetail)),
      action_date: asSgDate(cellValue(row, COL.actionDate)),
      first_initiated_at: asTimestamp(cellValue(row, COL.firstInitiated)),
      last_contact_at: asTimestamp(cellValue(row, COL.lastContact)),
      last_customer_response_at: asTimestamp(cellValue(row, COL.lastCustomerResponse)),
      interaction_summary: clean(cellValue(row, COL.interactionSummary)),
      historical_summary: clean(cellValue(row, COL.historicalSummary)),
      // Integer cents, per rules/code/typescript.md.
      latest_quote_cents: quote.cents,
      // Verbatim, in its own column. Writing it into interaction_summary would
      // be the import inventing content in a hand-typed field, which is exactly
      // what the store-verbatim rule forbids.
      latest_quote_note: quote.note,
      buying_readiness: clean(cellValue(row, COL.buyingReadiness)),
      keys_status: clean(cellValue(row, COL.keysStatus)),
      expected_key_date: clean(cellValue(row, COL.expectedKeyDate)),
      telegram_chat_id: clean(cellValue(row, COL.telegramChatId)),
      owner_id: owner.id,
      updated_at: new Date(),
    } as never;

    const existing = await db
      .selectFrom("leads")
      .select("id")
      .where("lead_ref", "=", leadRef)
      .executeTakeFirst();

    if (existing) {
      await db.updateTable("leads").set(values).where("lead_ref", "=", leadRef).execute();
      updated += 1;
    } else {
      await db.insertInto("leads").values(values).execute();
      inserted += 1;
    }
  }

  console.log(
    `leads import: ${inserted} inserted, ${updated} updated, ${skipped} blank rows ignored`,
  );
  // Printed, not buried: every one of these is a row a human should eyeball.
  if (notes.length > 0) {
    console.log(`\n${notes.length} rows needed handling:`);
    for (const note of notes) console.log(`  ${note}`);
  }
  await db.destroy();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
