import type { SgDate } from "./sg-date";

export type FunnelStage =
  | "New Lead"
  | "Not Qualified"
  | "Qualified / Pre-Appointment"
  | "Appointment Booked"
  | "Post-Appointment / Quote Pending"
  | "Quote Sent"
  | "Decision Pending"
  | "Nurture"
  | "Won"
  | "Lost";

export type LeadStatusValue =
  | "Active"
  | "Nurture"
  | "Ignore"
  | "Unresponsive"
  | "Won"
  | "Lost";

export type LeadOutcome =
  | "Customer Replied"
  | "No Response"
  | "Ready to Book Appointment"
  | "Barrier / Objection Raised"
  | "Appointment Booked"
  | "Appointment Completed"
  | "Quote Requested"
  | "Quote Sent"
  | "Customer Needs Time"
  | "Customer Declined"
  | "Order Confirmed"
  | "Appointment Confirmed"
  | "Follow-Up Sent"
  | "Renovation Delayed";

export type ActionRequired =
  | "Closed"
  | "Ignore Lead"
  | "Attend / Confirm Appointment"
  | "Resolve Barrier"
  | "Nurture / Re-engage"
  | "Follow Up – No Response"
  | "Book Appointment"
  | "Reply Required"
  | "Qualify Lead"
  | "Send Quote"
  | "Follow Up Quote"
  | "Push for Decision"
  | "Review Lead";

export type DueStatus =
  | "Closed"
  | "Schedule Date"
  | "Overdue"
  | "Due Today"
  | "Upcoming";

export type ContactPriority =
  | "Contact Today"
  | "Contact in 2–3 Days"
  | "Contact Within 7 Days"
  | "Future / Nurture"
  | "Closed";

export type QueueVisibility =
  | "Include"
  | "Exclude – Closed"
  | "Exclude – Ghosted"
  | "Exclude – Stale 90d+";

/** The only lead fields the engine reads. Keeps it trivially testable. */
export type LeadEngineInput = {
  funnel_stage: FunnelStage;
  lead_status: LeadStatusValue;
  last_outcome: LeadOutcome | null;
  action_detail_override: string | null;
  action_date: SgDate | null;
  last_customer_response_at: SgDate | null;
};

export type LeadDerived = {
  actionRequired: ActionRequired;
  nextAction: string;
  effectiveActionDate: SgDate | null;
  dueStatus: DueStatus;
  contactPriority: ContactPriority;
  queueVisibility: QueueVisibility;
  /** 1 = Contact Today … 4 = Future / Nurture. null when Closed. */
  priorityRank: 1 | 2 | 3 | 4 | null;
};

// `as const` tuples, not arrays. z.enum() needs a non-empty readonly tuple to
// infer the literal union; a plain FunnelStage[] widens to string, which is
// what forces `as never` casts through every server action downstream.
export const FUNNEL_STAGES = [
  "New Lead",
  "Not Qualified",
  "Qualified / Pre-Appointment",
  "Appointment Booked",
  "Post-Appointment / Quote Pending",
  "Quote Sent",
  "Decision Pending",
  "Nurture",
  "Won",
  "Lost",
] as const satisfies readonly FunnelStage[];

export const LEAD_STATUSES = [
  "Active",
  "Nurture",
  "Ignore",
  "Unresponsive",
  "Won",
  "Lost",
] as const satisfies readonly LeadStatusValue[];

export const LEAD_OUTCOMES = [
  "Customer Replied",
  "No Response",
  "Ready to Book Appointment",
  "Barrier / Objection Raised",
  "Appointment Booked",
  "Appointment Completed",
  "Quote Requested",
  "Quote Sent",
  "Customer Needs Time",
  "Customer Declined",
  "Order Confirmed",
  "Appointment Confirmed",
  "Follow-Up Sent",
  "Renovation Delayed",
] as const satisfies readonly LeadOutcome[];
