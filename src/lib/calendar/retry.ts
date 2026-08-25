/**
 * Retry policy for the Google Calendar API.
 *
 * Google returns rate-limit errors as 403 *or* 429 and asks for exponential
 * backoff with jitter. The important subtlety is that 403 is overloaded: it is
 * also what you get for insufficient scopes or a calendar you cannot edit.
 * Those are permanent, and retrying them burns the consultant's request for
 * nothing — so the reason string decides, not the status alone.
 *
 * Retries here are deliberately shallow. Sync runs inline after the booking has
 * already committed, with a human waiting, and the durable failure state plus
 * the "Retry" button on the appointment card is the real backoff mechanism at
 * the timescale that matters. In-process retries exist only to ride out a blip
 * without bothering anyone; anything longer belongs to the operator.
 */

/** Total attempts including the first. Two retries. */
export const MAX_ATTEMPTS = 3;

/**
 * Wall-clock ceiling for one sync, across every attempt and delay.
 *
 * Without this, retries silently reintroduce the hang that per-request
 * timeouts were added to prevent: three attempts at 10s plus backoff is most
 * of a minute staring at a spinner.
 */
export const CALENDAR_BUDGET_MS = 25_000;

const BASE_DELAY_MS = 500;

/** Rate-limit reasons. Anything else on a 403 is a permission problem. */
const RATE_LIMIT_REASONS = [
  "ratelimitexceeded",
  "userratelimitexceeded",
  "quotaexceeded",
  "backenderror",
];

/**
 * Whether a failed call is worth repeating.
 *
 * `body` is the raw response text; it is matched case-insensitively rather
 * than parsed, because the reason travels in different shapes depending on
 * which Google front-end answers (`error.errors[].reason` vs `error.status`)
 * and a parse failure must not be the thing that decides a retry.
 */
export function isRetryable(status: number, body: string): boolean {
  if (status === 429) return true;
  if (status >= 500) return true;

  if (status === 403) {
    const haystack = body.toLowerCase();
    return RATE_LIMIT_REASONS.some((reason) => haystack.includes(reason));
  }

  // 400, 401, 404, 409, 410, 412 and friends are permanent. Repeating them
  // changes nothing and delays the failure the operator needs to see.
  return false;
}

/**
 * `Retry-After` in milliseconds, or null when absent or unusable.
 *
 * Only the delta-seconds form is honoured. The HTTP-date form is legal but
 * Google does not send it, and accepting it would mean trusting a clock skew
 * we cannot check.
 */
export function retryAfterMs(header: string | null | undefined): number | null {
  if (!header) return null;
  const seconds = Number(header.trim());
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return Math.round(seconds * 1000);
}

/**
 * Backoff for a zero-based attempt index: 500ms, 1s, 2s … plus jitter.
 *
 * Jitter is not decoration. Every consultant's booking hitting the same
 * calendar retries on the same schedule otherwise, and a fleet that re-collides
 * on each round re-triggers the throttle it is backing off from.
 */
export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const base = BASE_DELAY_MS * 2 ** attempt;
  return base + Math.floor(random() * BASE_DELAY_MS);
}

/**
 * How long to wait before the next attempt, or null to give up now.
 *
 * Returns null when the delay would not leave time for the attempt that
 * follows it — waiting out the budget and then failing is strictly worse than
 * failing immediately, because the operator learns the same thing later.
 */
export function nextDelayMs(
  attempt: number,
  remainingMs: number,
  retryAfter: string | null | undefined,
  random: () => number = Math.random,
): number | null {
  if (attempt + 1 >= MAX_ATTEMPTS) return null;

  const delay = retryAfterMs(retryAfter) ?? backoffMs(attempt, random);
  return delay < remainingMs ? delay : null;
}
