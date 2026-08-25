/**
 * The `google_sync_error` written when the Google env vars are absent.
 *
 * `syncAppointment` records it and the appointment card matches on it, so the
 * two must agree exactly — hence one constant rather than two literals. No
 * `server-only` here on purpose: the card is a client component.
 *
 * The distinction matters because "not configured" is the permanent state of
 * every local dev box and of any environment without calendar credentials.
 * Rendering it as the amber "Calendar sync failed — Retry" banner would make a
 * missing setting look like an outage, on every appointment, forever, with a
 * retry button that cannot possibly succeed.
 */
export const CALENDAR_NOT_CONFIGURED =
  "Google Calendar is not configured on this environment";
