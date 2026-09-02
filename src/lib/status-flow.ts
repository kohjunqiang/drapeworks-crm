import type { FulfilmentStatus } from "@/lib/db/schema";
import type { FunnelStage, LeadOutcome } from "@/lib/leads/funnel-types";

export const STATUS_FLOW: FulfilmentStatus[] = [
  "order_recorded",
  "quotation_sent",
  "deposit_received",
  "po_ready",
  "sent_to_vendor",
  "sent_logistic",
  "shipping_sg",
  "delivered_checked",
  "fulfilment",
  "completed",
];

export const STATUS_LABELS: Record<FulfilmentStatus, string> = {
  order_recorded: "Order Recorded",
  quotation_sent: "Quotation Sent (to customer)",
  deposit_received: "Deposit Received",
  po_ready: "PO Ready",
  sent_to_vendor: "Sent to Vendor",
  sent_logistic: "Sent to Logistic Partner",
  shipping_sg: "Shipping to SG",
  delivered_checked: "Delivered & Checked",
  fulfilment: "Fulfillment Arrangement",
  completed: "Completed",
};

export const STATUS_COLOURS: Record<FulfilmentStatus, string> = {
  order_recorded: "bg-slate-100 text-slate-700",
  quotation_sent: "bg-sky-100 text-sky-700",
  deposit_received: "bg-amber-100 text-amber-700",
  po_ready: "bg-teal-100 text-teal-700",
  sent_to_vendor: "bg-orange-100 text-orange-700",
  sent_logistic: "bg-indigo-100 text-indigo-700",
  shipping_sg: "bg-blue-100 text-blue-700",
  delivered_checked: "bg-emerald-100 text-emerald-700",
  fulfilment: "bg-purple-100 text-purple-700",
  completed: "bg-green-100 text-green-700",
};

export function nextStatus(
  current: FulfilmentStatus,
): FulfilmentStatus | null {
  const i = STATUS_FLOW.indexOf(current);
  if (i < 0 || i >= STATUS_FLOW.length - 1) return null;
  return STATUS_FLOW[i + 1];
}

export function statusIndex(s: FulfilmentStatus): number {
  return STATUS_FLOW.indexOf(s);
}

export function leadMilestoneForOrderStatus(status: FulfilmentStatus): { stage: FunnelStage; outcome: LeadOutcome } | null {
  if (status === "quotation_sent") return { stage: "Decision Pending", outcome: "Quotation Sent" };
  if (status === "deposit_received") return { stage: "Won", outcome: "Customer Confirmed" };
  return null;
}

/** The lead state corresponding to an order milestone after an admin revert. */
export function leadStateForRevertedOrderStatus(
  status: FulfilmentStatus,
): { stage: FunnelStage; outcome: LeadOutcome | null } | null {
  if (status === "order_recorded") return { stage: "Send Quotation", outcome: null };
  if (status === "quotation_sent") return { stage: "Decision Pending", outcome: "Quotation Sent" };
  if (status === "deposit_received") return { stage: "Won", outcome: "Customer Confirmed" };
  return null;
}

// Once an order has gone to the vendor, its measurements are being cut. Editing
// the consultation behind that is how a customer ends up with curtains for a
// different window. The order reference stays editable (it is paperwork, not a
// manufacturing input) and so do status, notes, photos and amendments — those
// write to other tables.
export function isLocked(s: FulfilmentStatus): boolean {
  const i = statusIndex(s);
  // Fail CLOSED on a status this build does not know about. If someone adds a
  // value to the database enum before STATUS_FLOW catches up, statusIndex
  // returns -1, and treating that as "not locked" would leave orders editable
  // precisely when nobody knows what stage they are at.
  if (i < 0) return true;
  return i >= statusIndex("po_ready");
}
