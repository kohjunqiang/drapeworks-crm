import "server-only";

// Pinned to the v10 line on purpose. v11 declares `engines: node >= 22` (a
// Node 20 EOL policy bump, not an API change), and this app's Dockerfile runs
// node:20-alpine — so v11 installs with an unsatisfied engine constraint in
// production. v10 declares node >= 18 and exposes the identical OAuth2Client
// surface used below. Moving the whole app to Node 22 is the right long-term
// fix, but it deserves its own change; don't bump this package to get there.
import { OAuth2Client } from "google-auth-library";

import type { CalendarEvent } from "./event";
import { CALENDAR_BUDGET_MS, isRetryable, nextDelayMs } from "./retry";
import { CALENDAR_TIMEOUT_MS, withTimeout } from "./timeout";

export const SCOPES = ["https://www.googleapis.com/auth/calendar.events"];

// A stored refresh token, not a service-account key. The Google Cloud
// organisation enforces `iam.managed.disableServiceAccountKeyCreation`, so no
// service-account key can be issued at all — this is not a preference.
//
// Two consequences worth knowing. Events are created as the human who granted
// consent rather than as a neutral identity, so that person shows as organiser.
// And consent can be revoked, which a service-account key cannot be: that
// surfaces as `invalid_grant` on the token request, lands on the retry card
// like any other sync failure, and is fixed by re-running
// `npm run calendar:consent` to mint a new token.
//
// The consent screen must be configured as INTERNAL. An External app left in
// Testing status issues refresh tokens that expire after seven days, which
// looks exactly like a working integration until the week after it ships.
type Client = { oauth: OAuth2Client; calendarId: string };

let cached: { credentials: string; client: Client } | null = null;

function client(): Client {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  const calendarId = process.env.GOOGLE_CALENDAR_ID;

  if (!clientId || !clientSecret || !refreshToken || !calendarId) {
    throw new Error(
      "Google Calendar is not configured (GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REFRESH_TOKEN, GOOGLE_CALENDAR_ID)",
    );
  }

  // google-auth-library caches the access token on the client instance, so a
  // fresh instance per call means a full token refresh before every create,
  // patch and delete — doubling the round-trips to Google for no benefit.
  // Keyed on the credentials rather than built once, so that changing an env
  // var is picked up without a restart; the outage drill in the phase spec
  // does exactly that.
  const credentials = JSON.stringify([
    clientId,
    clientSecret,
    refreshToken,
    calendarId,
  ]);
  if (cached?.credentials === credentials) return cached.client;

  const oauth = new OAuth2Client({ clientId, clientSecret });
  oauth.setCredentials({ refresh_token: refreshToken });

  const next: Client = { oauth, calendarId };
  cached = { credentials, client: next };
  return next;
}

/**
 * A non-2xx response from the Calendar API, carrying the status as a number.
 *
 * The status is a field rather than something to read back out of the message,
 * because the message embeds the response body — and matching " 404" against a
 * string containing arbitrary JSON from Google will eventually match the wrong
 * thing and swallow a real failure as "already deleted".
 */
export class CalendarApiError extends Error {
  readonly status: number;

  constructor(status: number, method: string, detail: string) {
    super(`Google Calendar ${method} ${status}: ${detail}`);
    this.name = "CalendarApiError";
    this.status = status;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function attempt(
  method: "POST" | "PATCH" | "DELETE",
  path: string,
  body: unknown,
): Promise<Response> {
  const { oauth, calendarId } = client();

  // Both halves are bounded. Sync runs after the appointment is committed, so
  // a Google that hangs rather than fails must still end up on the retry card
  // instead of holding the consultant's request open until the socket dies.
  const { token } = await withTimeout(
    oauth.getAccessToken(),
    CALENDAR_TIMEOUT_MS,
    "token request",
  );

  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
    calendarId,
  )}/events${path}`;

  return fetch(url, {
    method,
    signal: AbortSignal.timeout(CALENDAR_TIMEOUT_MS),
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

async function call(
  method: "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<Record<string, unknown>> {
  // One wall-clock budget for the whole operation, retries and sleeps
  // included. Per-request timeouts alone do not bound a retry loop.
  const deadline = Date.now() + CALENDAR_BUDGET_MS;

  for (let i = 0; ; i += 1) {
    const response = await attempt(method, path, body);

    if (response.ok) {
      // DELETE returns 204 with an empty body.
      return response.status === 204 ? {} : await response.json();
    }

    const detail = await response.text();

    // 403 is overloaded: a rate limit is worth waiting out, insufficient
    // scopes never will be. isRetryable reads the reason, not just the status.
    if (!isRetryable(response.status, detail)) {
      throw new CalendarApiError(response.status, method, detail);
    }

    const delay = nextDelayMs(
      i,
      deadline - Date.now(),
      response.headers.get("retry-after"),
    );
    if (delay === null) {
      throw new CalendarApiError(response.status, method, detail);
    }

    await sleep(delay);
  }
}

export async function createEvent(event: CalendarEvent): Promise<string> {
  const created = await call("POST", "", event);
  const id = created.id;
  if (typeof id !== "string") {
    throw new Error("Google Calendar returned no event id");
  }
  return id;
}

export async function patchEvent(
  eventId: string,
  event: Partial<CalendarEvent>,
): Promise<void> {
  await call("PATCH", `/${encodeURIComponent(eventId)}`, event);
}

export async function deleteEvent(eventId: string): Promise<void> {
  try {
    await call("DELETE", `/${encodeURIComponent(eventId)}`);
  } catch (error) {
    // Already gone is the desired end state, not a failure. 404 = no such
    // event, 410 = deleted already; both mean there is nothing left to remove.
    if (
      error instanceof CalendarApiError &&
      (error.status === 404 || error.status === 410)
    ) {
      return;
    }
    throw error;
  }
}

export function isCalendarConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_OAUTH_CLIENT_ID &&
      process.env.GOOGLE_OAUTH_CLIENT_SECRET &&
      process.env.GOOGLE_OAUTH_REFRESH_TOKEN &&
      process.env.GOOGLE_CALENDAR_ID,
  );
}
