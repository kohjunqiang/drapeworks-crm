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

// Column K. Note there is no entry for 'Resolve Barrier': the spreadsheet has
// none either, so that action yields a blank instruction. Ported deliberately
// — see queue-engine.test.ts and the "bugs carried knowingly" section of
// docs/specs/phase-15-leads-and-appointments.md.
const NEXT_ACTION_PHRASES: Partial<Record<ActionRequired, string>> = {
  "Reply Required": "Reply to latest customer message",
  "Qualify Lead": "Establish need, timing and property details",
  "Book Appointment": "Offer 2 consultation slots",
  "Attend / Confirm Appointment": "Confirm / attend consultation",
  "Send Quote": "Prepare and send quotation",
  "Follow Up Quote": "Follow up on quotation and ask for decision",
  "Push for Decision": "Resolve barrier and ask for commitment",
  "Nurture / Re-engage": "Re-engage at the appropriate key / renovation timing",
  "Follow Up – No Response": "Send a value-adding follow-up / reactivation",
};

export function deriveNextAction(
  action: ActionRequired,
  override: string | null,
): string {
  if (override && override.trim() !== "") return override;
  return NEXT_ACTION_PHRASES[action] ?? "";
}

import type { DueStatus } from "./types";
import type { SgDate } from "./sg-date";

/**
 * Column M. The guard here is narrower than column N's — it excludes only
 * 'Closed', not 'Ignore Lead'. That asymmetry is in the spreadsheet.
 */
export function deriveEffectiveActionDate(
  action: ActionRequired,
  actionDate: SgDate | null,
  today: SgDate,
): SgDate | null {
  if (action === "Closed") return null;
  if (actionDate) return actionDate;
  if (action === "Reply Required" || action === "Send Quote") return today;
  return null;
}

/** Column N. */
export function deriveDueStatus(
  action: ActionRequired,
  effectiveDate: SgDate | null,
  today: SgDate,
): DueStatus {
  if (action === "Closed" || action === "Ignore Lead") return "Closed";
  if (!effectiveDate) return "Schedule Date";
  if (effectiveDate < today) return "Overdue";
  if (effectiveDate === today) return "Due Today";
  return "Upcoming";
}

import { addDays } from "./sg-date";
import type { ContactPriority } from "./types";

const DATELESS_URGENT: ActionRequired[] = [
  "Qualify Lead",
  "Book Appointment",
  "Follow Up Quote",
  "Push for Decision",
  "Follow Up – No Response",
];

/**
 * Column X.
 *
 * The final `else` catches 'Ignore Lead', 'Resolve Barrier' and 'Review Lead'
 * and gives them a live priority. For Ignore Lead that is a spreadsheet bug —
 * ported deliberately; see the spec's "bugs carried knowingly" section.
 */
export function deriveContactPriority(
  lead: LeadEngineInput,
  action: ActionRequired,
  effectiveDate: SgDate | null,
  today: SgDate,
): ContactPriority {
  if (
    lead.funnel_stage === "Won" ||
    lead.funnel_stage === "Lost" ||
    action === "Closed"
  ) {
    return "Closed";
  }

  // The customer is waiting on us. Nothing outranks that.
  if (action === "Reply Required" || action === "Send Quote") {
    return "Contact Today";
  }

  if (effectiveDate) {
    if (effectiveDate <= today) return "Contact Today";
    if (effectiveDate <= addDays(today, 3)) return "Contact in 2–3 Days";
    if (effectiveDate <= addDays(today, 7)) return "Contact Within 7 Days";
    return "Future / Nurture";
  }

  if (action === "Nurture / Re-engage") return "Future / Nurture";
  if (action === "Attend / Confirm Appointment") return "Contact Today";
  if (DATELESS_URGENT.includes(action)) return "Contact in 2–3 Days";
  return "Contact Within 7 Days";
}
