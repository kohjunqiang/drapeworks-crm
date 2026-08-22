import "server-only";

// Pinned to the v10 line on purpose. v11 declares `engines: node >= 22` (a
// Node 20 EOL policy bump, not an API change), and this app's Dockerfile runs
// node:20-alpine — so v11 installs with an unsatisfied engine constraint in
// production. v10 declares node >= 18 and exposes the identical JWT surface
// used below. Moving the whole app to Node 22 is the right long-term fix, but
// it deserves its own change; don't bump this package to get there.
import { JWT } from "google-auth-library";

import type { CalendarEvent } from "./event";

const SCOPES = ["https://www.googleapis.com/auth/calendar.events"];

function client(): { jwt: JWT; calendarId: string } {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  const calendarId = process.env.GOOGLE_CALENDAR_ID;

  if (!email || !key || !calendarId) {
    throw new Error(
      "Google Calendar is not configured (GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_SERVICE_ACCOUNT_KEY, GOOGLE_CALENDAR_ID)",
    );
  }

  return {
    // Railway env vars cannot hold real newlines, so the private key is stored
    // with literal \n sequences and unescaped here.
    jwt: new JWT({ email, key: key.replace(/\\n/g, "\n"), scopes: SCOPES }),
    calendarId,
  };
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

async function call(
  method: "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<Record<string, unknown>> {
  const { jwt, calendarId } = client();
  const { token } = await jwt.getAccessToken();

  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
    calendarId,
  )}/events${path}`;

  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new CalendarApiError(response.status, method, detail);
  }

  // DELETE returns 204 with an empty body.
  return response.status === 204 ? {} : await response.json();
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
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
      process.env.GOOGLE_SERVICE_ACCOUNT_KEY &&
      process.env.GOOGLE_CALENDAR_ID,
  );
}
