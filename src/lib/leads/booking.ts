import type { FunnelStage } from "./funnel-types";
import { isClosedLeadStage } from "./priority";

export function bookingBlockedReason(lead: {
  funnel_stage: FunnelStage;
  is_archived?: boolean | null;
}): string | null {
  if (lead.is_archived) return "This lead is archived and cannot be booked.";
  if (isClosedLeadStage(lead.funnel_stage)) {
    return `This lead is closed (${lead.funnel_stage}). Reopen it before booking an appointment.`;
  }
  return null;
}
