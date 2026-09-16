import { describe, expect, it } from "vitest";
import { parseLeadSort, sortLeadRows } from "./workspace-sort";
import { deriveActionRequired, deriveDueStatus } from "./funnel-engine";
import type { FunnelStage, DueStatus } from "./funnel-types";

const row = (id: string, date: string | null, due: DueStatus = "Upcoming") => ({ id, next_action_date_text: date, due, funnel_stage: due === "Closed" ? "Won" : "Qualify Lead", priority_score: null as number | null });
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


describe("Priority ranking uses actual funnel closure", () => {
  it.each(["Won", "Lost", "Not Qualified"] as const)("keeps an open declined lead before %s", stage => {
    const rows = [
      { ...row("closed", null), funnel_stage: stage as FunnelStage, last_outcome: null, priority_score: 100 },
      { ...row("open-declined", "2026-09-15"), funnel_stage: "Qualify Lead" as FunnelStage, last_outcome: "Customer Declined" as const, priority_score: 20 },
    ];
    const due = (lead: typeof rows[number]) => deriveDueStatus(deriveActionRequired({...lead,next_action_date:lead.next_action_date_text}, "2026-09-16"),lead.next_action_date_text,"2026-09-16");
    expect(rows.map(due)).toEqual(["Closed", "Closed"]);
    expect(sortLeadRows(rows, "priority", "desc", due).map(lead => lead.id)).toEqual(["open-declined", "closed"]);
  });
  it("orders by the persisted score, including within a due category", () => {
    const rows = [
      {...row("lower", "2026-09-15", "Due Today"),priority_score:20,latest_quote_cents:200000},
      {...row("higher", "2026-09-15", "Due Today"),priority_score:84,latest_quote_cents:0},
      {...row("pending", "2026-09-15", "Due Today"),priority_score:null,latest_quote_cents:500000},
    ];
    for (const sort of ["priority", "due"] as const) expect(sortLeadRows(rows,sort,sort === "due" ? "asc" : "desc",dueFor).map(lead=>lead.id)).toEqual(["higher","lower","pending"]);
  });
});
