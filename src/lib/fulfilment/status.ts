import type { FulfilmentStatus } from "@/lib/db/schema";
import { statusIndex } from "@/lib/status-flow";

/**
 * Installation may be booked once vendor measurements are frozen. Booking it
 * early is calendar planning only; the fulfilment status still advances one
 * step at a time.
 */
export function canScheduleInstallation(status: FulfilmentStatus): boolean {
  return statusIndex(status) >= statusIndex("po_ready") &&
    statusIndex(status) <= statusIndex("fulfilment");
}
