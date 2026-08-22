import "server-only";

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
    throw new Error(`Google Calendar ${method} ${response.status}: ${detail}`);
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
    // Already gone is the desired end state, not a failure.
    if (error instanceof Error && error.message.includes(" 410")) return;
    if (error instanceof Error && error.message.includes(" 404")) return;
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
