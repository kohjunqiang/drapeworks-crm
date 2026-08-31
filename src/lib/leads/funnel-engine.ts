import { addDays, type SgDate } from "./sg-date";
import type { ActionRequired, BuyingReadiness, DueStatus, FunnelEngineInput, FunnelStage, LeadStatus, Recommendation } from "./funnel-types";

export const FUNNEL_POSITION: Record<FunnelStage, number> = { "Qualify Lead": 0, "Nurture Lead – Long Term": 1, "Activate Lead – Short Term": 2, "Book Appointment": 3, "Attend Appointment": 4, "Send Quotation": 5, "Collect Deposit": 6, "Decision Pending": 7, Won: 8, Lost: 8, "Not Qualified": 0 };
export const STAGE_RANK: Record<FunnelStage, number> = { "Collect Deposit": 8, "Decision Pending": 7, "Send Quotation": 6, "Attend Appointment": 5, "Book Appointment": 4, "Activate Lead – Short Term": 3, "Qualify Lead": 2, "Nurture Lead – Long Term": 1, Won: 0, Lost: 0, "Not Qualified": 0 };

export function deriveLeadStatus(stage: FunnelStage, unanswered: number): LeadStatus {
  if (stage === "Won") return "Closed – Won";
  if (stage === "Lost") return "Closed – Lost";
  if (stage === "Not Qualified") return "Closed – Not Qualified";
  return unanswered >= 2 ? "Unresponsive" : "Active";
}
export function deriveActionRequired(lead: Pick<FunnelEngineInput, "funnel_stage" | "last_outcome" | "next_action_date">, today: SgDate): ActionRequired {
  const stage = lead.funnel_stage, outcome = lead.last_outcome, date = lead.next_action_date;
  if (stage === "Won") return "Won";
  if (stage === "Lost" || stage === "Not Qualified") return "Closed";
  if (outcome === "Customer Confirmed") return "Won";
  if (outcome === "Customer Declined") return "Closed";
  if (outcome === "Awaiting Customer") return date !== null && date <= today ? "Follow-Up" : "Awaiting Customer";
  if (outcome === "Customer Replied") return "Reply Required";
  if (outcome === "No Response") return "Follow-Up";
  if (outcome === "Pre-Appointment Barrier") return "Resolve Appointment Barrier";
  if (outcome === "Post-Appointment Barrier") return "Resolve Closing Barrier";
  if (outcome === "Appointment Booked") return "Confirm / Attend Appointment";
  if (outcome === "Quotation Sent") return "Push for Deposit";
  switch (stage) {
    case "Qualify Lead": return "Qualify Lead"; case "Nurture Lead – Long Term": return "Nurture Lead"; case "Activate Lead – Short Term": return "Activate Lead"; case "Book Appointment": return "Book Appointment"; case "Attend Appointment": return "Confirm / Attend Appointment"; case "Send Quotation": return "Send Quotation"; case "Collect Deposit": return "Push for Deposit"; case "Decision Pending": return "Push for Decision";
  }
}
export function deriveDueStatus(action: ActionRequired, date: SgDate | null, today: SgDate): DueStatus { if (action === "Closed" || action === "Won") return "Closed"; if (!date) return action === "Reply Required" || action === "Send Quotation" ? "Due Today" : "No Date"; return date < today ? "Overdue" : date === today ? "Due Today" : "Upcoming"; }
export function deriveBuyingReadiness(stage: FunnelStage): BuyingReadiness { if (stage === "Nurture Lead – Long Term") return "Low"; if (stage === "Activate Lead – Short Term") return "Medium"; return FUNNEL_POSITION[stage] >= 3 && !["Won", "Lost", "Not Qualified"].includes(stage) ? "High" : null; }
export function deriveDaysToMoveIn(date: SgDate | null, today: SgDate): number | null { if (!date) return null; return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000); }
export function deriveQuoteValidUntil(sent: SgDate | null, days: number): SgDate | null { return sent ? addDays(sent, days) : null; }
export function deriveCurrentOwner(lead: FunnelEngineInput, presales: string | null): string | null { return FUNNEL_POSITION[lead.funnel_stage] >= 4 ? lead.assigned_consultant_id ?? lead.owner_id ?? presales : presales ?? lead.owner_id; }
export function deriveRecommendations(lead: FunnelEngineInput, today: SgDate): Recommendation[] {
  if (["Won", "Lost", "Not Qualified"].includes(lead.funnel_stage)) return [];
  const out: Recommendation[] = [];
  if (lead.last_outcome === "Customer Confirmed") out.push({ code: "customer-confirmed", message: "Move this lead to Won", suggestedStage: "Won", clearsOutcome: false });
  if (lead.last_outcome === "Customer Declined") out.push({ code: "customer-declined", message: "Move this lead to Lost", suggestedStage: "Lost", clearsOutcome: false });
  if (lead.last_outcome === "Appointment Booked" && FUNNEL_POSITION[lead.funnel_stage] < 4) out.push({ code: "appointment-booked", message: "Move this lead to Attend Appointment", suggestedStage: "Attend Appointment", clearsOutcome: false });
  if (lead.last_outcome === "Quotation Sent" && lead.funnel_stage === "Send Quotation") out.push({ code: "quotation-sent", message: "Move this lead to Collect Deposit", suggestedStage: "Collect Deposit", clearsOutcome: false });
  const valid = deriveQuoteValidUntil(lead.quotation_sent_at, lead.quote_valid_days);
  if (lead.funnel_stage === "Collect Deposit" && valid && valid < today) out.push({ code: "quote-aged", message: "The initial quote window has passed", suggestedStage: "Decision Pending", clearsOutcome: true });
  const days = deriveDaysToMoveIn(lead.move_in_date, today);
  if ((lead.funnel_stage === "Nurture Lead – Long Term" || lead.funnel_stage === "Activate Lead – Short Term") && days !== null && days <= 60) out.push({ code: "move-in-near", message: "Review readiness: move-in is within 60 days", suggestedStage: null, clearsOutcome: false });
  return out.filter((r) => !((lead as FunnelEngineInput & { dismissed_recommendations?: string[] }).dismissed_recommendations ?? []).includes(r.code));
}
export function deriveLead(lead: FunnelEngineInput, today: SgDate, presales: string | null) { const actionRequired = deriveActionRequired(lead, today); return { leadStatus: deriveLeadStatus(lead.funnel_stage, lead.unanswered_followups), actionRequired, dueStatus: deriveDueStatus(actionRequired, lead.next_action_date, today), buyingReadiness: deriveBuyingReadiness(lead.funnel_stage), daysToMoveIn: deriveDaysToMoveIn(lead.move_in_date, today), quoteValidUntil: deriveQuoteValidUntil(lead.quotation_sent_at, lead.quote_valid_days), currentOwnerId: deriveCurrentOwner(lead, presales), recommendations: deriveRecommendations(lead, today) }; }
