/**
 * Google caller-supplied event IDs accept base32hex characters. Prefixing the
 * UUID distinguishes appointment events from other deterministic event types.
 */
export function appointmentCalendarEventId(appointmentId: string): string {
  return `a${appointmentId.replaceAll("-", "").toLowerCase()}`;
}
