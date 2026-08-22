import { describe, expect, it } from "vitest";

import fixture from "./__fixtures__/spreadsheet-parity.json";
import { deriveLead } from "./queue-engine";
import type { LeadEngineInput } from "./types";

/**
 * The acceptance test for the spreadsheet port, frozen so it outlives the
 * spreadsheet itself (retired in Task 26).
 *
 * Every case is one real row's inputs paired with the value Excel's own
 * formulas produced for it. `recalculatedOn` pins the engine's TODAY() to the
 * moment the sheet last recalculated — without it these expectations would rot
 * overnight.
 *
 * A failure here means the engine has drifted from the system it replaced.
 *
 * THE ONE SELF-REFERENTIAL CASE. Sheet row 215 had its Action Required formula
 * typed over by hand with 'Nurture / Re-engage' — the shared-formula run splits
 * around it (I5:I214, then I216:I247), which is the fingerprint of the edit. Its
 * Next Action cell is still a formula, but reads the typed value, so it diverges
 * too. No ported rule can reproduce a hand-typed literal: two other rows with
 * identical inputs (sheet rows 168 and 186) yield 'Push for Decision' from the
 * live formula. So for those two fields `expected` carries the ENGINE's value
 * and `excelOverride` preserves what the human wrote. That case proves nothing
 * on its own — which is exactly why the fourth test below pins it to one row and
 * two fields. The row's other four columns are live formulas and are compared
 * normally, so its coverage is not lost. Alan can set that lead's funnel stage
 * to Nurture in the CRM if that was his intent; the data was not touched here.
 *
 * COVERAGE CAVEAT. The real data exercises 9 of the cascade's 16 branches.
 * 'Barrier / Objection Raised', 'Send Quote' and outcome-driven 'Reply
 * Required' have zero rows, so this suite never reaches the TODAY() branch of
 * the effective-date rule or the second branch of contact priority. Of the
 * three known spreadsheet bugs it proves exactly one — the Ignore Lead queue
 * leak. The Resolve Barrier blank instruction and the Dashboard undercount are
 * unit-test-only, which is why queue-engine.test.ts is not redundant with this
 * file. See the spec's "bugs carried knowingly" section before changing
 * anything here.
 */
describe("spreadsheet parity", () => {
  it("covers every lead that was in the spreadsheet", () => {
    // 244, not 246: rows 251 and 253 are an operator instruction and a TODAY()
    // helper block, and row 253's leading cells are dates that survive a naive
    // emptiness check.
    expect(fixture.cases).toHaveLength(244);
  });

  it("is pinned to the date the spreadsheet last recalculated", () => {
    // Without this the expectations would rot the day after generation.
    expect(fixture.recalculatedOn).toBe("2026-08-21");
  });

  it("exercises only the 9 branches the real data reaches", () => {
    // Locks in the caveat above, so that if someone later hand-edits the
    // fixture the coverage claim in the spec stops being true loudly.
    const actions = new Set(fixture.cases.map((c) => c.expected.actionRequired));
    expect(actions.size).toBe(9);
    expect(actions.has("Resolve Barrier")).toBe(false);
    expect(actions.has("Send Quote")).toBe(false);
    expect(actions.has("Reply Required")).toBe(false);
  });

  it("carries exactly one hand-edited row, and only its two affected fields", () => {
    // The circularity stops here. Those two fields are the engine checked
    // against itself; every other one of the 1,462 comparisons is checked
    // against a real cached formula result. If a future regeneration produces a
    // second override — or widens this one — that is a formula the engine no
    // longer reproduces wearing an override's clothing, and this fails.
    const overrides = fixture.cases.flatMap((c) =>
      "excelOverride" in c ? [c.excelOverride] : [],
    );

    expect(overrides).toHaveLength(1);
    expect(overrides[0]).toEqual({
      actionRequired: "Nurture / Re-engage",
      nextAction: "Re-engage at the appropriate key / renovation timing",
    });
  });

  it.each(fixture.cases.map((c) => [c.index, c] as const))(
    "row %i matches the spreadsheet",
    (_index, testCase) => {
      const derived = deriveLead(
        testCase.input as LeadEngineInput,
        fixture.recalculatedOn,
      );

      expect({
        actionRequired: derived.actionRequired,
        nextAction: derived.nextAction || null,
        effectiveActionDate: derived.effectiveActionDate,
        dueStatus: derived.dueStatus,
        contactPriority: derived.contactPriority,
        queueVisibility: derived.queueVisibility,
      }).toEqual(testCase.expected);
    },
  );
});
