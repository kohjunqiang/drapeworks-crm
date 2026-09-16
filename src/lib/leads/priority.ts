/** Current sales attention assessment, independent of funnel/status/action logic. */
export const BUYING_STAGES = ["Pre-Keys", "Keys Collected", "3D / Design Completed", "Carpentry Completed", "Move-In Within 2 Months"] as const;
export const ENGAGEMENT_QUALITIES = ["Low", "Medium", "High"] as const;
export const PRIORITY_CLASSES = ["A", "B", "C", "D", "Pending"] as const;
export type PriorityClass = "A" | "B" | "C" | "D";
export interface PriorityInput {
  funnel_stage?: string | null;
  renovation_buying_stage?: string | null;
  engagement_quality?: string | null;
  latest_quote_cents?: number | null;
}
export const PRIORITY_MEANINGS = {
  A: { label: "Highest Priority", explanation: "High-potential opportunity that deserves immediate and personalised sales attention." },
  B: { label: "Active Priority", explanation: "Good active opportunity. Maintain momentum and convert efficiently." },
  C: { label: "Nurture", explanation: "Real opportunity, but lower current urgency/value. Manage through structured nurture." },
  D: { label: "Low Priority", explanation: "Currently low priority. Handle efficiently and reassess if the opportunity improves." },
} as const;
export const ENGAGEMENT_HELP = {
  Low: "Difficult to get responses; ignores questions, gives vague or incomplete answers, mainly collects prices, or provides little useful information.",
  Medium: "Replies normally, provides enough information, makes a genuine enquiry and asks some relevant questions.",
  High: "Highly responsive; proactively asks relevant questions, shares plans, measurements or renovation details, and seriously discusses appointments, samples or quotations.",
} as const;
/** Persisted generated fields are required: callers must select them, never recompute. */
export interface StoredPriority {
  readiness_score: number | null;
  commercial_value_score: number | null;
  engagement_quality_score: number | null;
  priority_score: number | null;
  priority_class: string | null;
}
export function readPriority(lead: StoredPriority): Omit<StoredPriority, "priority_class"> & { priority_class: PriorityClass | null; missing: string[] } {
  const missing = [
    lead.readiness_score === null ? "Renovation / Buying Stage" : null,
    lead.commercial_value_score === null ? "Order Value" : null,
    lead.engagement_quality_score === null ? "Engagement Quality" : null,
  ].filter((value): value is string => value !== null);
  const category = lead.priority_class;
  return {
    readiness_score: lead.readiness_score,
    commercial_value_score: lead.commercial_value_score,
    engagement_quality_score: lead.engagement_quality_score,
    priority_score: lead.priority_score,
    priority_class: category === "A" || category === "B" || category === "C" || category === "D" ? category : null,
    missing,
  };
}
export function isClosedLeadStage(stage: string) {
  return stage === "Won" || stage === "Lost" || stage === "Not Qualified";
}
export function comparePriority(a: Pick<StoredPriority, "priority_score">, b: Pick<StoredPriority, "priority_score">) {
  return (b.priority_score ?? -1) - (a.priority_score ?? -1);
}
