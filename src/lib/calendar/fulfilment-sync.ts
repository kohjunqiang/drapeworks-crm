import "server-only";

import { db } from "@/lib/db/kysely";
import { loadInstallationSummary } from "@/lib/fulfilment/load-installation-summary";

import { CALENDAR_NOT_CONFIGURED } from "./messages";
import {
  CalendarApiError,
  createEvent,
  isCalendarConfigured,
  patchEvent,
} from "./google";

/**
 * Sync an order's installation booking after the database commit. As with
 * consultation appointments, Calendar is a side effect and never a write gate.
 */
export async function syncFulfilmentArrangement(arrangementId: string): Promise<void> {
  if (!isCalendarConfigured()) {
    await db
      .updateTable("fulfilment_arrangements")
      .set({
        google_sync_state: "failed",
        google_sync_error: CALENDAR_NOT_CONFIGURED,
      })
      .where("id", "=", arrangementId)
      .execute();
    return;
  }

  try {
    const arrangement = await db
      .selectFrom("fulfilment_arrangements")
      .select([
        "id",
        "order_id",
        "scheduled_at",
        "duration_mins",
        "address",
        "google_event_id",
      ])
      .where("id", "=", arrangementId)
      .executeTakeFirstOrThrow();
    const summary = await loadInstallationSummary(
      arrangement.order_id,
      arrangement.scheduled_at,
      arrangement.duration_mins,
      arrangement.address,
    );
    const start = new Date(arrangement.scheduled_at);
    const end = new Date(start.getTime() + arrangement.duration_mins * 60_000);
    const event = {
      summary: `Installation — ${summary.customerName} (${summary.displayId})`,
      location: arrangement.address,
      description: [
        summary.text,
        `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/orders/${arrangement.order_id}`,
      ].join("\n\n"),
      start: { dateTime: start.toISOString(), timeZone: "Asia/Singapore" },
      end: { dateTime: end.toISOString(), timeZone: "Asia/Singapore" },
    };

    let eventId = arrangement.google_event_id;
    if (eventId) {
      try {
        await patchEvent(eventId, event);
      } catch (error) {
        // An installer may delete the event in Google. Recreate it instead of
        // leaving Retry permanently stuck patching an id that no longer exists.
        if (!(error instanceof CalendarApiError) || ![404, 410].includes(error.status)) {
          throw error;
        }
        eventId = await createEvent(event);
      }
    } else {
      eventId = await createEvent(event);
    }

    await db
      .updateTable("fulfilment_arrangements")
      .set({
        google_event_id: eventId,
        google_sync_state: "synced",
        google_sync_error: null,
      })
      .where("id", "=", arrangementId)
      .execute();
  } catch (error) {
    await db
      .updateTable("fulfilment_arrangements")
      .set({
        google_sync_state: "failed",
        google_sync_error:
          error instanceof Error ? error.message.slice(0, 1000) : "Unknown error",
      })
      .where("id", "=", arrangementId)
      .execute();
  }
}
