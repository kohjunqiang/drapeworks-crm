import type { ActionRequired, LeadEngineInput } from "./types";

/**
 * Column I of the Leads sheet, branch for branch.
 *
 * Order is load-bearing. The outcome branches sit above the stage branches
 * because a customer response puts the ball back with Drapeworks regardless of
 * where the lead sits in the funnel. Reordering these silently changes the
 * morning worklist.
 */
export function deriveActionRequired(lead: LeadEngineInput): ActionRequired {
  const { funnel_stage: stage, lead_status: status, last_outcome: outcome } = lead;

  // 1–2: terminal states, checked before anything else.
  if (stage === "Won" || stage === "Lost") return "Closed";
  if (stage === "Not Qualified" || status === "Ignore") return "Ignore Lead";

  // 3–8: the outcome overrides the stage.
  if (outcome === "Appointment Confirmed") return "Attend / Confirm Appointment";
  if (outcome === "Barrier / Objection Raised") return "Resolve Barrier";
  if (outcome === "Customer Needs Time") return "Nurture / Re-engage";
  if (outcome === "No Response") return "Follow Up – No Response";
  if (outcome === "Ready to Book Appointment") return "Book Appointment";
  if (outcome === "Customer Replied") return "Reply Required";

  // 9–15: otherwise the stage decides.
  if (stage === "Nurture") return "Nurture / Re-engage";
  if (stage === "New Lead") return "Qualify Lead";
  if (stage === "Qualified / Pre-Appointment") return "Book Appointment";
  if (stage === "Appointment Booked") return "Attend / Confirm Appointment";
  if (stage === "Post-Appointment / Quote Pending") return "Send Quote";
  if (stage === "Quote Sent") return "Follow Up Quote";
  if (stage === "Decision Pending") return "Push for Decision";

  return "Review Lead";
}
