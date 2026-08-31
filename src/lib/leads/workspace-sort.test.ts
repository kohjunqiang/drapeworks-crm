import { describe, expect, it } from "vitest";
import { parseLeadSort, sortLeadRows } from "./workspace-sort";
import type { DueStatus } from "./funnel-types";

const row = (id: string, date: string | null, due: DueStatus = "Upcoming") => ({ id, next_action_date_text: date, due });
const dueFor = (value: ReturnType<typeof row>) => value.due;
describe("Lead workspace sorting", () => {
  it("sorts initiation timestamps newest first with missing dates last", () => {
    const rows = [
      { ...row("old", null), first_initiated_at: "2026-08-20T12:00:00Z" },
      { ...row("missing", null), first_initiated_at: null },
      { ...row("latest", null), first_initiated_at: "2026-08-31T12:00:00Z" },
    ];
    expect(sortLeadRows(rows, "initiated", "desc", dueFor).map(r=>r.id)).toEqual(["latest", "old", "missing"]);
    expect(sortLeadRows(rows, "initiated", "asc", dueFor).map(r=>r.id)).toEqual(["old", "latest", "missing"]);
    expect(parseLeadSort("newest")).toBe("initiated");
  });
  it("defaults unknown values to newest", () => {
    expect(parseLeadSort(undefined)).toBe("initiated");
    expect(parseLeadSort("invalid")).toBe("initiated");
  });
  it("sorts dates in both directions with missing dates last", () => {
    const rows = [row("blank", null), row("early", "2026-01-01"), row("late", "2026-09-01")];
    expect(sortLeadRows(rows, "next", "asc", dueFor).map(r => r.id)).toEqual(["early", "late", "blank"]);
    expect(sortLeadRows(rows, "next", "desc", dueFor).map(r => r.id)).toEqual(["late", "early", "blank"]);
    expect(rows[0].id).toBe("blank");
  });
  it("sorts urgency rather than alphabetically and reverses it", () => {
    const rows = [row("closed", null, "Closed"), row("upcoming", "2026-09-01"), row("today", null, "Due Today"), row("overdue", "2026-01-01", "Overdue"), row("no-date", null, "No Date")];
    expect(sortLeadRows(rows, "due", "asc", dueFor).map(r => r.id)).toEqual(["overdue", "today", "upcoming", "no-date", "closed"]);
    expect(sortLeadRows(rows, "due", "desc", dueFor).map(r => r.id)).toEqual(["closed", "no-date", "upcoming", "today", "overdue"]);
  });
  it("preserves newest-first tie order and sorts before a page slice", () => {
    const rows = [row("newer", "2026-09-01"), row("older", "2026-09-01"), row("earliest", "2026-01-01")];
    expect(sortLeadRows(rows, "next", "asc", dueFor).slice(0, 2).map(r => r.id)).toEqual(["earliest", "newer"]);
    expect(sortLeadRows(rows, "initiated", "asc", dueFor)).toEqual(rows);
  });
});
