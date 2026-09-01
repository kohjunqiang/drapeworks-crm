import type { SgDate } from "./sg-date";

export const FUNNEL_STAGES = ["Qualify Lead", "Nurture Lead – Long Term", "Activate Lead – Short Term", "Book Appointment", "Attend Appointment", "Send Quotation", "Collect Deposit", "Decision Pending", "Won", "Lost", "Not Qualified"] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];
export const ATTEND_APPOINTMENT_STAGE = "Attend Appointment" satisfies FunnelStage;
export const LEAD_STATUSES = ["Active", "Unresponsive", "Closed – Won", "Closed – Lost", "Closed – Not Qualified"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
export const LEAD_OUTCOMES = ["Customer Replied", "Awaiting Customer", "No Response", "Pre-Appointment Barrier", "Appointment Booked", "Quotation Sent", "Post-Appointment Barrier", "Customer Declined", "Customer Confirmed"] as const;
export type LeadOutcome = (typeof LEAD_OUTCOMES)[number];
export const CONTACT_CHANNELS = ["Telegram", "WhatsApp", "Other"] as const;
export const LEAD_SOURCES = ["Telegram Group Buy", "SEM", "Organic", "Carousell", "Referral", "Existing Customer", "Other"] as const;
export const LEAD_DIRECTIONS = ["Inbound", "Outbound"] as const;
export const PRIMARY_PRODUCTS = ["Curtains / Blinds", "Mesh", "Both"] as const;
// Keep historical Both records readable, but do not offer it for new selections.
export const SELECTABLE_PRIMARY_PRODUCTS = ["Curtains / Blinds", "Mesh"] as const;
export const CLOSURE_REASONS = ["Competitor", "Price / Budget", "Ghosted", "Small Order / Low Value", "Product Mismatch", "Timing / No Longer Needed", "Communication / Poor Fit", "Outside Scope", "Other"] as const;
export const INTERACTION_TYPES = ["Customer Message", "Reply", "Follow-Up", "Appointment", "Quote", "Payment", "Note"] as const;
export type ActionRequired = "Reply Required" | "Follow-Up" | "Awaiting Customer" | "Resolve Appointment Barrier" | "Book Appointment" | "Confirm / Attend Appointment" | "Send Quotation" | "Push for Deposit" | "Push for Decision" | "Resolve Closing Barrier" | "Nurture Lead" | "Activate Lead" | "Qualify Lead" | "Closed" | "Won";
export type DueStatus = "Overdue" | "Due Today" | "Upcoming" | "No Date" | "Closed";
export type BuyingReadiness = "Low" | "Medium" | "High" | null;
export type FunnelEngineInput = { funnel_stage: FunnelStage; last_outcome: LeadOutcome | null; next_action_date: SgDate | null; unanswered_followups: number; move_in_date: SgDate | null; quotation_sent_at: SgDate | null; quote_valid_days: number; assigned_consultant_id: string | null; owner_id: string | null; };
export type Recommendation = { code: "customer-confirmed" | "customer-declined" | "appointment-booked" | "quotation-sent" | "quote-aged" | "move-in-near"; message: string; suggestedStage: FunnelStage | null; clearsOutcome: boolean };
