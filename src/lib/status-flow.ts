import type { FulfilmentStatus } from "@/lib/db/schema";

export const STATUS_FLOW: FulfilmentStatus[] = [
  "order_recorded",
  "deposit_received",
  "sent_to_vendor",
  "sent_logistic",
  "shipping_sg",
  "delivered_checked",
  "fulfilment",
  "completed",
];

export const STATUS_LABELS: Record<FulfilmentStatus, string> = {
  order_recorded: "Order Recorded",
  deposit_received: "Deposit Received",
  sent_to_vendor: "Sent to Vendor",
  sent_logistic: "Sent to Logistic Partner",
  shipping_sg: "Shipping to SG",
  delivered_checked: "Delivered & Checked",
  fulfilment: "Fulfilment Arrangement",
  completed: "Completed",
};

export const STATUS_COLOURS: Record<FulfilmentStatus, string> = {
  order_recorded: "bg-slate-100 text-slate-700",
  deposit_received: "bg-amber-100 text-amber-700",
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

// Once an order has gone to the vendor, its measurements are being cut. Editing
// the consultation behind that is how a customer ends up with curtains for a
// different window. The order reference stays editable (it is paperwork, not a
// manufacturing input) and so do status, notes, photos and amendments — those
// write to other tables.
export function isLocked(s: FulfilmentStatus): boolean {
  return statusIndex(s) >= statusIndex("sent_to_vendor");
}
