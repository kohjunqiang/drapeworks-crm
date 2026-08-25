/**
 * How long any single Google Calendar round-trip may take before it is treated
 * as a failure.
 *
 * Booking commits the appointment first and syncs afterwards, so a slow Google
 * costs the consultant a spinner rather than the booking. Ten seconds is long
 * enough that a merely sluggish API still succeeds, and short enough that an
 * outage lands on the "Calendar sync failed — Retry" card while the consultant
 * is still looking at it.
 */
export const CALENDAR_TIMEOUT_MS = 10_000;

/**
 * Rejects if `promise` has not settled within `ms`.
 *
 * `AbortSignal.timeout` covers `fetch`, but the OAuth token exchange happens
 * inside google-auth-library and takes no signal — so the un-timed half of
 * every request needs this. The underlying work is not cancelled; it is
 * abandoned. That is acceptable here because the caller's only response to a
 * timeout is to record the failure and offer a retry.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Google Calendar ${label} timed out after ${ms}ms`)),
          ms,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
