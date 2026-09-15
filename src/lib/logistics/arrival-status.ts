import type { FulfilmentStatus } from "@/lib/db/schema";

/** Items can arrive independently while other items are still with vendors. */
export function canRecordShipmentArrival(status: FulfilmentStatus): boolean {
  return status === "sent_to_vendor" || status === "sent_logistic" || status === "shipping_sg";
}
