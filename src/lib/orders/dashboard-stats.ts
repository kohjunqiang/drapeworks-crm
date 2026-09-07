import type { FulfilmentStatus } from "@/lib/db/schema";

export const IN_PRODUCTION_STATUSES = ["sent_to_vendor"] as const satisfies readonly FulfilmentStatus[];

export const AWAITING_SHIPMENT_STATUSES = [
  "sent_logistic",
  "shipping_sg",
] as const satisfies readonly FulfilmentStatus[];

export const READY_FOR_INSTALLATION_STATUSES = [
  "delivered_checked",
  "fulfilment",
] as const satisfies readonly FulfilmentStatus[];

/** Active is exactly the sum of the three non-overlapping operational cards. */
export const ACTIVE_ORDER_STATUSES = [
  ...IN_PRODUCTION_STATUSES,
  ...AWAITING_SHIPMENT_STATUSES,
  ...READY_FOR_INSTALLATION_STATUSES,
] as const satisfies readonly FulfilmentStatus[];

/** What the unfiltered Orders page shows: pipeline entry plus active work. */
export const DEFAULT_ORDER_LIST_STATUSES = [
  "order_recorded",
  "quotation_sent",
  ...ACTIVE_ORDER_STATUSES,
] as const satisfies readonly FulfilmentStatus[];
