import "server-only";

import { db } from "@/lib/db/kysely";
import { loadInstallationSummary } from "@/lib/fulfilment/load-installation-summary";

import { fulfilmentCalendarEventId } from "./fulfilment-event-id";
import { CALENDAR_NOT_CONFIGURED } from "./messages";
import {
  CalendarApiError,
  createEvent,
  deleteEvent,
  isCalendarConfigured,
  patchEvent,
} from "./google";

/**
 * Sync an order's installation booking after the database commit. As with
 * consultation appointments, Calendar is a side effect and never a write gate.
 */
export type FulfilmentSyncResult =
  | { ok: true }
  | { ok: false; error: string };

async function createIdempotentEvent(
  arrangementId: string,
  event: Parameters<typeof createEvent>[0],
): Promise<string> {
  const eventId = fulfilmentCalendarEventId(arrangementId);
  try {
    return await createEvent(event, eventId);
  } catch (error) {
    // A concurrent request may have inserted the deterministic id first. In
    // that case, update that same event to the latest database state.
    if (!(error instanceof CalendarApiError) || error.status !== 409) {
      throw error;
    }
    await patchEvent(eventId, event);
    return eventId;
  }
}

export async function syncFulfilmentArrangement(
  arrangementId: string,
): Promise<FulfilmentSyncResult> {
  try {
    // A booking may be edited while an earlier Calendar request is in flight.
    // updated_at is an optimistic version: if it changed, reconcile again from
    // the newest database state instead of recording a stale external result.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const arrangement = await db
        .selectFrom("fulfilment_arrangements")
        .select([
          "id",
          "order_id",
          "scheduled_at",
          "duration_mins",
          "address",
          "google_event_id",
          "cancelled_at",
          "updated_at",
        ])
        .where("id", "=", arrangementId)
        .executeTakeFirstOrThrow();

      // Cancellation is database-first. Reconciliation then removes both a
      // stored legacy id and the deterministic id a concurrent create may use.
      if (arrangement.cancelled_at) {
        if (!isCalendarConfigured() && arrangement.google_event_id) {
          throw new Error(CALENDAR_NOT_CONFIGURED);
        }
        if (isCalendarConfigured()) {
          const eventIds = new Set([
            ...(arrangement.google_event_id
              ? [arrangement.google_event_id]
              : []),
            fulfilmentCalendarEventId(arrangement.id),
          ]);
          for (const eventId of eventIds) await deleteEvent(eventId);
        }
        const updated = await db
          .updateTable("fulfilment_arrangements")
          .set({
            google_event_id: null,
            google_sync_state: "synced",
            google_sync_error: null,
          })
          .where("id", "=", arrangementId)
          .where("updated_at", "=", arrangement.updated_at)
          .returning("id")
          .executeTakeFirst();
        if (updated) return { ok: true };
        continue;
      }

      if (!isCalendarConfigured()) {
        throw new Error(CALENDAR_NOT_CONFIGURED);
      }

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
          // leaving Retry permanently stuck patching a missing id.
          if (
            !(error instanceof CalendarApiError) ||
            ![404, 410].includes(error.status)
          ) {
            throw error;
          }
          eventId = await createIdempotentEvent(arrangement.id, event);
        }
      } else {
        eventId = await createIdempotentEvent(arrangement.id, event);
      }

      const updated = await db
        .updateTable("fulfilment_arrangements")
        .set({
          google_event_id: eventId,
          google_sync_state: "synced",
          google_sync_error: null,
        })
        .where("id", "=", arrangementId)
        .where("updated_at", "=", arrangement.updated_at)
        .returning("id")
        .executeTakeFirst();
      if (updated) return { ok: true };
    }
    throw new Error("Installation changed repeatedly during Calendar sync");
  } catch (error) {
    const message =
      error instanceof Error ? error.message.slice(0, 1000) : "Unknown error";
    await db
      .updateTable("fulfilment_arrangements")
      .set({
        google_sync_state: "failed",
        google_sync_error: message,
      })
      .where("id", "=", arrangementId)
      .execute();
    return { ok: false, error: message };
  }
}
