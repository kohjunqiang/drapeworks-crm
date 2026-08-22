import { addDays } from "./sg-date";
import type { SgDate } from "./sg-date";
import type {
  ActionRequired,
  ContactPriority,
  DueStatus,
  LeadDerived,
  LeadEngineInput,
  QueueVisibility,
} from "./types";

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

/** Column Z. */
export function deriveQueueVisibility(
  lead: LeadEngineInput,
  action: ActionRequired,
  today: SgDate,
): QueueVisibility {
  if (
    lead.funnel_stage === "Won" ||
    lead.funnel_stage === "Lost" ||
    action === "Closed"
  ) {
    return "Exclude – Closed";
  }
  if (lead.lead_status === "Unresponsive") return "Exclude – Ghosted";
  // A Nurture lead is waiting on keys or renovation, not ghosting us.
  if (
    lead.funnel_stage !== "Nurture" &&
    lead.last_customer_response_at &&
    lead.last_customer_response_at < addDays(today, -90)
  ) {
    return "Exclude – Stale 90d+";
  }
  return "Include";
}

const PRIORITY_RANK: Record<ContactPriority, 1 | 2 | 3 | 4 | null> = {
  "Contact Today": 1,
  "Contact in 2–3 Days": 2,
  "Contact Within 7 Days": 3,
  "Future / Nurture": 4,
  Closed: null,
};

/** Everything the eight formula columns produced, for one lead. */
export function deriveLead(lead: LeadEngineInput, today: SgDate): LeadDerived {
  const actionRequired = deriveActionRequired(lead);
  const effectiveActionDate = deriveEffectiveActionDate(
    actionRequired,
    lead.action_date,
    today,
  );
  const contactPriority = deriveContactPriority(
    lead,
    actionRequired,
    effectiveActionDate,
    today,
  );

  return {
    actionRequired,
    nextAction: deriveNextAction(actionRequired, lead.action_detail_override),
    effectiveActionDate,
    dueStatus: deriveDueStatus(actionRequired, effectiveActionDate, today),
    contactPriority,
    queueVisibility: deriveQueueVisibility(lead, actionRequired, today),
    priorityRank: PRIORITY_RANK[contactPriority],
  };
}

/**
 * Within a priority band, order by action. The Daily Queue sheet numbers its
 * action cells and cell A2 instructs "Use Z→A sort", so the highest number is
 * worked first.
 *
 * OBSERVED — these six numbers are printed in the sheet's own cells:
 *   07 Attend / Confirm Appointment
 *   06 Book Appointment
 *   04 Push for Decision
 *   03 Qualify Lead
 *   02 Nurture / Re-engage
 *   01 Follow Up – No Response
 *
 * INFERRED — four ranks this port chose, because no queue-visible lead is in
 * those states and the sheet therefore never numbered them. Each is marked
 * below. They follow the principle the priority rule already encodes: the
 * customer waiting on us outranks everything.
 *
 * Anything absent falls to 0 via `?? 0` and sinks. That is right for
 * 'Ignore Lead' (it matches the unnumbered row in the sheet) and moot for
 * 'Review Lead' (unreachable — every funnel_stage has a branch and the column
 * is a NOT NULL enum), but it would be WRONG for 'Resolve Barrier', which
 * means a customer raised an objection. It is ranked explicitly rather than
 * left to sink below a no-response follow-up.
 */
const ACTION_RANK: Partial<Record<ActionRequired, number>> = {
  "Reply Required": 9,               // INFERRED — ball is with us
  "Send Quote": 8,                   // INFERRED — ball is with us
  "Attend / Confirm Appointment": 7, // observed
  "Book Appointment": 6,             // observed
  "Follow Up Quote": 5,              // INFERRED — 05 is the gap in the numbering
  "Resolve Barrier": 4,              // INFERRED — peer of Push for Decision,
                                     // which shares its next-action phrase
  "Push for Decision": 4,            // observed
  "Qualify Lead": 3,                 // observed
  "Nurture / Re-engage": 2,          // observed
  "Follow Up – No Response": 1,      // observed
  // 'Ignore Lead' and 'Review Lead' deliberately absent — see above.
};

/**
 * Replaces the sheet's Queue Seq columns (W and Y). Those are running COUNTIFS
 * that exist only because a spreadsheet needs a sortable number in a cell; a
 * database just sorts.
 */
export function compareQueueRows(
  a: { name: string; derived: LeadDerived },
  b: { name: string; derived: LeadDerived },
): number {
  const rankA = a.derived.priorityRank ?? 99;
  const rankB = b.derived.priorityRank ?? 99;
  if (rankA !== rankB) return rankA - rankB;

  // Higher action rank first, matching the sheet's Z→A sort. Unranked actions
  // ('Ignore Lead' — the one that leaks into the queue) sink to the bottom,
  // which is exactly where the sheet's unnumbered row sits today.
  const actionA = ACTION_RANK[a.derived.actionRequired] ?? 0;
  const actionB = ACTION_RANK[b.derived.actionRequired] ?? 0;
  if (actionA !== actionB) return actionB - actionA;

  // Then the soonest date; undated rows sink within their group.
  const dateA = a.derived.effectiveActionDate ?? "9999-12-31";
  const dateB = b.derived.effectiveActionDate ?? "9999-12-31";
  if (dateA !== dateB) return dateA < dateB ? -1 : 1;

  return a.name.localeCompare(b.name);
}
