// Independent test oracle only. Production scoring is owned by database-generated columns.
import { BUYING_STAGES, type PriorityInput, type PriorityClass } from "../priority";

export function priorityClassFor(score: number): PriorityClass {
  return score >= 80 ? "A" : score >= 65 ? "B" : score >= 45 ? "C" : "D";
}
export function calculatePriority(input: PriorityInput) {
  const stageIndex = BUYING_STAGES.indexOf(input.renovation_buying_stage as typeof BUYING_STAGES[number]);
  const readiness_score = stageIndex < 0 ? null : stageIndex + 1;
  const engagement_quality_score = input.engagement_quality === "Low" ? 1 : input.engagement_quality === "Medium" ? 3 : input.engagement_quality === "High" ? 5 : null;
  const cents = input.latest_quote_cents;
  const commercial_value_score = cents == null || !Number.isSafeInteger(cents) || cents < 0 ? null : cents < 60000 ? 1 : cents < 90000 ? 2 : cents < 120000 ? 3 : cents < 180000 ? 4 : 5;
  const missing = [readiness_score === null ? "Renovation / Buying Stage" : null, commercial_value_score === null ? "Order Value" : null, engagement_quality_score === null ? "Engagement Quality" : null].filter((value): value is string => value !== null);
  const priority_score = readiness_score === null || commercial_value_score === null || engagement_quality_score === null ? null : readiness_score * 8 + commercial_value_score * 8 + engagement_quality_score * 4;
  return { readiness_score, commercial_value_score, engagement_quality_score, priority_score, priority_class: priority_score === null ? null : priorityClassFor(priority_score), missing };
}
