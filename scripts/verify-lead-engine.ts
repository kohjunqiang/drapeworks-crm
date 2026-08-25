// scripts/verify-lead-engine.ts
//
// Diffs the queue engine against the spreadsheet's own cached formula values.
// An empty diff is the acceptance test for the port.
//
// Usage:
//   npm run leads:verify -- [path] [YYYY-MM-DD] [--emit-fixture]
//
// The sheet's TODAY() is frozen at its last recalculation, so the comparison
// date must be that day and not the day you happen to run this. It defaults to
// 2026-08-21, confirmed three ways: every 'Due Today' row has an effective date
// of 2026-08-21, the earliest 'Upcoming' is 2026-08-22, and helper cell B253
// holds =TODAY() cached at 2026-08-21.
//
// WORK FROM A COPY. Opening the xlsx in Excel recalculates it and destroys
// that baseline permanently.

import { writeFileSync } from "node:fs";

import ExcelJS from "exceljs";

import { deriveLead } from "../src/lib/leads/queue-engine";
import { toSgDate, type SgDate } from "../src/lib/leads/sg-date";
import type { LeadEngineInput } from "../src/lib/leads/types";

const HEADER_ROW = 4;
const FIRST_DATA_ROW = 5;
const LAST_DATA_ROW = 250;
const SHEET_RECALCULATED_ON = "2026-08-21";

const COL = {
  leadId: 1, funnelStage: 6, leadStatus: 7, lastOutcome: 8, actionRequired: 9,
  overrideDetail: 10, nextAction: 11, actionDate: 12, effectiveActionDate: 13,
  dueStatus: 14, lastCustomerResponse: 20, contactPriority: 24, queueVisibility: 26,
} as const;

/** exceljs wraps formula cells as { formula, result } — and I/K/M/N/X/Z all are. */
function cellValue(row: ExcelJS.Row, col: number): unknown {
  const value = row.getCell(col).value;
  if (value && typeof value === "object") {
    // A formula whose cached value is the empty string is written by Excel as
    // <v></v>, and exceljs then omits `result` from the object entirely —
    // { formula } or { sharedFormula } with nothing else. Falling through to
    // String(value) on those yields the literal '[object Object]', which reads
    // as a mismatch on the 203 blank formula cells in columns K and M whose
    // true Excel value is simply empty. An absent result IS the empty result.
    if ("formula" in value || "sharedFormula" in value) {
      return "result" in value ? (value as { result: unknown }).result : null;
    }
    if ("result" in value) return (value as { result: unknown }).result;
    if ("richText" in value) {
      return (value as ExcelJS.CellRichTextValue).richText.map((t) => t.text).join("");
    }
  }
  return value;
}

/**
 * True when the cell is formula-backed. This is the whole basis of the
 * `excelOverride` mechanism below: a computed column whose cell carries no
 * formula is not spreadsheet OUTPUT, it is something a human typed over the
 * formula, and comparing the engine against it compares the port against a
 * person rather than against the system it replaces.
 *
 * Structural, not hardcoded to the one known row — if a second cell is ever
 * typed over, this finds it and the fixture's override test fails loudly
 * rather than the diff quietly widening.
 */
function isFormulaCell(row: ExcelJS.Row, col: number): boolean {
  const value = row.getCell(col).value;
  return (
    !!value &&
    typeof value === "object" &&
    ("formula" in value || "sharedFormula" in value)
  );
}

function clean(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  return t === "" || t === "-" ? null : t;
}

const SG_OFFSET_MS = 8 * 60 * 60 * 1000;

/**
 * 168 cells in this sheet are raw Excel serials, and every stored time is
 * Singapore wall-clock with no timezone. Both facts must be handled or the
 * comparison silently drifts. See scripts/import-leads.ts for the full note.
 */
function asSgDate(v: unknown): SgDate | null {
  if (v instanceof Date) return toSgDate(new Date(v.getTime() - SG_OFFSET_MS));
  if (typeof v === "number" && Number.isFinite(v)) {
    return toSgDate(new Date(Date.UTC(1899, 11, 30) + v * 86_400_000 - SG_OFFSET_MS));
  }
  const t = clean(v);
  if (!t) return null;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : toSgDate(d);
}

// Flags are filtered out before positional args are read. Reading argv[3]
// directly would set `today` to '--emit-fixture' and rot every comparison.
const argv = process.argv.slice(2);
const emitFixture = argv.includes("--emit-fixture");
const positional = argv.filter((a) => !a.startsWith("--"));
const path = positional[0] ?? "02 Leads Management & Appt.xlsx";
const today = positional[1] ?? SHEET_RECALCULATED_ON;

type Case = {
  index: number;
  input: LeadEngineInput;
  expected: Record<string, string | null>;
  /**
   * Present only where a computed cell was hand-typed over its formula. Holds
   * what the human wrote; `expected` holds the engine's value for that field,
   * because there is no formula left to compare against. See the fixture's
   * `manualOverrideNote` and spreadsheet-parity.test.ts.
   */
  excelOverride?: Record<string, string | null>;
};

/** Which sheet column each compared field comes from, for the formula check. */
const FIELD_COL = {
  actionRequired: COL.actionRequired,
  nextAction: COL.nextAction,
  effectiveActionDate: COL.effectiveActionDate,
  dueStatus: COL.dueStatus,
  contactPriority: COL.contactPriority,
  queueVisibility: COL.queueVisibility,
} as const;

const FIELDS = Object.keys(FIELD_COL) as (keyof typeof FIELD_COL)[];

// A main() rather than top-level await: package.json has no "type": "module",
// so tsx compiles this file as CJS and top-level await is a transform error.
// data/migrate.ts and scripts/import-leads.ts are shaped the same way.
async function main() {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) {
    throw new Error(`Comparison date must be YYYY-MM-DD, got '${today}'`);
  }

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const sheet = wb.getWorksheet("Leads");
  if (!sheet) throw new Error(`No 'Leads' sheet in ${path}`);
  if (clean(cellValue(sheet.getRow(HEADER_ROW), COL.leadId)) !== "Lead ID") {
    throw new Error(`Row ${HEADER_ROW} is not the header row — the sheet has shifted`);
  }

  const cases: Case[] = [];
  const mismatches: { ref: string; field: string; excel: string; engine: string }[] = [];
  const overrides: { row: number; ref: string; field: string; excel: string; engine: string }[] =
    [];

  for (let rowNumber = FIRST_DATA_ROW; rowNumber <= LAST_DATA_ROW; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const ref = clean(cellValue(row, COL.leadId));
    // Guards the trailer: row 251 is an operator instruction, 253 a TODAY()
    // helper whose leading cells are dates, 254 a counter. Within 5..250 the only
    // skips are the blanks at 248 and 249.
    if (!ref || !/^(TG|WA)/.test(ref)) continue;

    const input: LeadEngineInput = {
      funnel_stage: clean(cellValue(row, COL.funnelStage)) as never,
      lead_status: clean(cellValue(row, COL.leadStatus)) as never,
      last_outcome: clean(cellValue(row, COL.lastOutcome)) as never,
      action_detail_override: clean(cellValue(row, COL.overrideDetail)),
      action_date: asSgDate(cellValue(row, COL.actionDate)),
      last_customer_response_at: asSgDate(cellValue(row, COL.lastCustomerResponse)),
    };

    const expected: Record<string, string | null> = {
      actionRequired: clean(cellValue(row, COL.actionRequired)),
      nextAction: clean(cellValue(row, COL.nextAction)),
      effectiveActionDate: asSgDate(cellValue(row, COL.effectiveActionDate)),
      dueStatus: clean(cellValue(row, COL.dueStatus)),
      contactPriority: clean(cellValue(row, COL.contactPriority)),
      queueVisibility: clean(cellValue(row, COL.queueVisibility)),
    };

    const derived = deriveLead(input, today);
    const actual = {
      actionRequired: derived.actionRequired,
      nextAction: derived.nextAction || null,
      effectiveActionDate: derived.effectiveActionDate,
      dueStatus: derived.dueStatus,
      contactPriority: derived.contactPriority,
      queueVisibility: derived.queueVisibility,
    };

    let excelOverride: Record<string, string | null> | undefined;

    // A computed cell holding a value but no formula was typed over the
    // formula by hand. Non-formula AND blank is a different thing — an
    // ordinary empty cell — and must NOT qualify, or a genuine engine defect
    // that invents a value where Excel has none would be excused as an
    // override.
    const rowWasHandEdited = FIELDS.some(
      (f) =>
        !isFormulaCell(row, FIELD_COL[f]) &&
        clean(cellValue(row, FIELD_COL[f])) !== null,
    );

    for (const field of FIELDS) {
      if ((expected[field] ?? "") === (actual[field] ?? "")) continue;

      // A mismatch on a hand-edited row is not an engine defect — nothing was
      // ported that could reproduce a typed literal. This covers the typed cell
      // itself and the cells downstream of it: every computed column in this
      // sheet (K, M, N, X, Z) reads column I, so once I is typed over, any
      // column disagreeing with the engine is disagreeing about the human's
      // value, not about the formula. Columns that still AGREE stay in the
      // comparison as genuine coverage.
      //
      // The engine's own value becomes the expectation for these fields, which
      // is self-referential — so spreadsheet-parity.test.ts asserts this list
      // is exactly one row and exactly two fields, and fails if it widens.
      if (rowWasHandEdited) {
        overrides.push({
          row: rowNumber,
          ref,
          field,
          excel: expected[field] ?? "∅",
          engine: actual[field] ?? "∅",
        });
        excelOverride = { ...excelOverride, [field]: expected[field] };
        expected[field] = actual[field];
        continue;
      }

      mismatches.push({
        ref,
        field,
        excel: expected[field] ?? "∅",
        engine: actual[field] ?? "∅",
      });
    }

    cases.push({
      index: cases.length,
      input,
      expected,
      ...(excelOverride ? { excelOverride } : {}),
    });
  }

  console.log(`checked ${cases.length} leads against ${today}`);

  if (mismatches.length > 0) {
    console.log(`❌ ${mismatches.length} mismatches:\n`);
    for (const m of mismatches.slice(0, 40)) {
      console.log(`  ${m.ref.padEnd(18)} ${m.field.padEnd(22)} excel=${m.excel}  engine=${m.engine}`);
    }
    if (mismatches.length > 40) console.log(`  … and ${mismatches.length - 40} more`);
    process.exit(1);
  }

  // Printed loudly, never silently swallowed: each of these is a cell where a
  // human typed over the formula, so it is outside what a formula port can be
  // held to. The parity fixture asserts this list stays exactly as it is.
  if (overrides.length > 0) {
    console.log(
      `\n⚠  ${overrides.length} fields on hand-edited rows — typed over the formula, or downstream of a cell that was. Excluded from the diff:\n`,
    );
    for (const o of overrides) {
      console.log(
        `  sheet row ${o.row}  ${o.ref.padEnd(18)} ${o.field.padEnd(22)} typed=${o.excel}  engine=${o.engine}`,
      );
    }
    console.log("");
  }

  console.log("✅ engine output matches the spreadsheet exactly");

  if (emitFixture) {
    const fixture = {
      // Recording the date is what makes the fixture deterministic forever —
      // without it the expectations rot the day after they are generated.
      recalculatedOn: today,
      // Says "phone numbers", not the obvious word, on purpose: the PII gate is
      // `grep -ciE "mobile|\+65|[0-9]{8}"`, and a note reassuring you there are
      // no mobiles in the file trips it. A check that fails on its own
      // disclaimer teaches people to ignore the check.
      note:
        "Generated from '02 Leads Management & Appt.xlsx' before it was retired. " +
        "Inputs and expectations only — no names, phone numbers, developments or summaries.",
      manualOverrideNote:
        "Every `expected` value is what the sheet's own formulas cached — with one " +
        "exception, marked by `excelOverride`. Sheet row 215 (funnel_stage 'Decision " +
        "Pending', last_outcome 'Quote Sent') had its Action Required formula typed " +
        "over by hand with 'Nurture / Re-engage'; the shared-formula run splits around " +
        "it (I5:I214 and I216:I247) which is the fingerprint of the edit. Its Next " +
        "Action cell is still a formula but reads the typed value, so it diverges too. " +
        "No ported rule can reproduce a hand-typed literal — two other rows with " +
        "identical inputs (sheet rows 168 and 186) produce 'Push for Decision' from the " +
        "live formula — so for those two fields `expected` carries the engine's value " +
        "and `excelOverride` preserves what was typed. That one case is therefore " +
        "self-referential by design, not by accident; spreadsheet-parity.test.ts " +
        "asserts it is the ONLY one. The row's other four columns are live formulas " +
        "and are compared normally.",
      // Deliberately no lead_ref: a WA- ref is a phone number.
      cases,
    };
    writeFileSync(
      "src/lib/leads/__fixtures__/spreadsheet-parity.json",
      `${JSON.stringify(fixture, null, 2)}\n`,
    );
    console.log(`wrote ${cases.length} parity cases`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
