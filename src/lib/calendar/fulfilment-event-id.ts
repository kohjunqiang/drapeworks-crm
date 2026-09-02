/**
 * Google caller-supplied event ids use base32hex characters. A UUID without
 * hyphens is stable, valid, and lets concurrent retries converge on one event.
 */
export function fulfilmentCalendarEventId(arrangementId: string): string {
  return arrangementId.replaceAll("-", "").toLowerCase();
}
