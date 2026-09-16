import { describe, expect, it } from "vitest";
import { BUYING_STAGES, readPriority } from "./priority";
import { calculatePriority, priorityClassFor } from "./__fixtures__/priority-reference";
import { sortLeadRows } from "./workspace-sort";
import { leadCreateSchema, leadDetailsSchema, leadQuickEditSchema } from "../validation/lead";

describe("Lead priority", () => {
  it("reads persisted scores without recalculating from manual inputs", () => {
    // Deliberately conflicting inputs prove display consumes the database values.
    const saved = { renovation_buying_stage: "Pre-Keys", latest_quote_cents: 0, engagement_quality: "Low",
      readiness_score: 4, commercial_value_score: 4, engagement_quality_score: 5, priority_score: 84, priority_class: "A" };
    expect(readPriority(saved)).toEqual({readiness_score:4,commercial_value_score:4,engagement_quality_score:5,priority_score:84,priority_class:"A",missing:[]});
    expect(readPriority({...saved, commercial_value_score:null,priority_score:null,priority_class:null})).toMatchObject({priority_score:null,priority_class:null,missing:["Order Value"]});
  });

  it.each([
    ["Move-In Within 2 Months", 55000, "High", 5, 1, 5, 68, "B"],
    ["Carpentry Completed", 150000, "High", 4, 4, 5, 84, "A"],
    ["Keys Collected", 150000, "Medium", 2, 4, 3, 60, "C"],
    ["Move-In Within 2 Months", 40000, "Low", 5, 1, 1, 52, "C"],
    ["Carpentry Completed", null, "High", 4, null, 5, null, null],
  ])("acceptance: %s / %s / %s", (stage, cents, quality, readiness, commercial, engagement, total, category) => {
    expect(calculatePriority({ renovation_buying_stage: stage as string, latest_quote_cents: cents as number | null, engagement_quality: quality as string })).toMatchObject({ readiness_score: readiness, commercial_value_score: commercial, engagement_quality_score: engagement, priority_score: total, priority_class: category });
  });
  it.each([[0,1],[59999,1],[60000,2],[89999,2],[90000,3],[119999,3],[120000,4],[179999,4],[180000,5]])("price boundary %s cents", (cents, expected) => {
    expect(calculatePriority({latest_quote_cents:cents}).commercial_value_score).toBe(expected);
  });
  it.each([[44,"D"],[45,"C"],[64,"C"],[65,"B"],[79,"B"],[80,"A"],[100,"A"]])("category boundary %s", (score, category) => expect(priorityClassFor(Number(score))).toBe(category));
  it("never defaults missing/invalid inputs, but accepts genuine zero", () => {
    expect(calculatePriority({}).missing).toEqual(["Renovation / Buying Stage","Order Value","Engagement Quality"]);
    for (const cents of [null, undefined, NaN, Infinity, -1, 1.5]) expect(calculatePriority({latest_quote_cents:cents}).commercial_value_score).toBeNull();
    expect(calculatePriority({renovation_buying_stage:"unknown",engagement_quality:"unknown"}).priority_score).toBeNull();
    expect(calculatePriority({latest_quote_cents:0}).missing).not.toContain("Order Value");
  });
  it("uses only the furthest selected stage and recalculates dynamically", () => {
    for (const [i, stage] of BUYING_STAGES.entries()) expect(calculatePriority({renovation_buying_stage:stage}).readiness_score).toBe(i+1);
    const before = {renovation_buying_stage:"Keys Collected",latest_quote_cents:150000,engagement_quality:"Medium"};
    expect(calculatePriority(before).priority_score).toBe(60);
    expect(calculatePriority({...before,renovation_buying_stage:"Move-In Within 2 Months"}).priority_score).toBe(84);
  });
  it("preserves urgency ahead of score and places Pending last within a due category", () => {
    const high = {priority_score:100,renovation_buying_stage:"Move-In Within 2 Months",latest_quote_cents:200000,engagement_quality:"High"};
    const rows = [
      {funnel_stage:"Qualify Lead",id:"future",...high,due:"Upcoming" as const,next_action_date_text:"2026-10-01"},
      {funnel_stage:"Qualify Lead",priority_score:null,id:"pending",due:"Due Today" as const,next_action_date_text:"2026-09-15"},
      {funnel_stage:"Qualify Lead",id:"today",...high,due:"Due Today" as const,next_action_date_text:"2026-09-15"},
      {funnel_stage:"Qualify Lead",priority_score:null,id:"overdue",due:"Overdue" as const,next_action_date_text:"2026-09-14"},
      {funnel_stage:"Won",id:"closed",...high,due:"Closed" as const,next_action_date_text:null},
    ];
    expect(sortLeadRows(rows,"due","asc",r=>r.due).map(r=>r.id)).toEqual(["overdue","today","pending","future","closed"]);
    expect(sortLeadRows(rows,"priority","desc",r=>r.due).at(-1)?.id).toBe("closed");
  });
  it("validates manual fields in create, details and quick edit; rejects manual scores", () => {
    const common = { name:"Test",contact_channel:"Other",first_initiated_date:"2026-09-15",id:"00000000-0000-4000-8000-000000000001",owner_id:"00000000-0000-4000-8000-000000000002",expected_updated_at:new Date(),funnel_stage:"Qualify Lead",latest_quote_sgd:"",source:"",primary_product:"" };
    for (const schema of [leadCreateSchema,leadDetailsSchema,leadQuickEditSchema]) {
      const parsed = schema.parse({...common,renovation_buying_stage:"",engagement_quality:"",priority_score:100});
      expect(parsed).toMatchObject({renovation_buying_stage:null,engagement_quality:null,latest_quote_sgd:null});
      expect(parsed).not.toHaveProperty("priority_score");
      expect(schema.safeParse({...common,engagement_quality:"Very High"}).success).toBe(false);
    }
  });
});
