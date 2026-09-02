import "server-only";

import { db } from "@/lib/db/kysely";

import { appointmentCalendarEventId } from "./appointment-event-id";
import { buildConsultationEvent } from "./event";
import { CALENDAR_NOT_CONFIGURED } from "./messages";
import {
  CalendarApiError,
  createEvent,
  deleteEvent,
  isCalendarConfigured,
  patchEvent,
} from "./google";

export type CalendarSyncResult =
  | { ok: true }
  | { ok: false; error: string };

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message.slice(0, 1000) : "Unknown error";

async function createIdempotentEvent(
  appointmentId: string,
  event: Parameters<typeof createEvent>[0],
): Promise<string> {
  const eventId = appointmentCalendarEventId(appointmentId);
  try {
    return await createEvent(event, eventId);
  } catch (error) {
    if (!(error instanceof CalendarApiError) || error.status !== 409) throw error;
    await patchEvent(eventId, event);
    return eventId;
  }
}

/**
 * Pushes an appointment to the shared calendar and records the outcome.
 *
 * Never throws. Sync is a side effect of booking, not part of it — the
 * appointment is already committed by the time this runs, and a Google outage
 * must not be able to lose it. Failures are surfaced in the UI with a retry.
 */
export async function syncAppointment(
  appointmentId: string,
): Promise<CalendarSyncResult> {
  let observedUpdatedAt: Date | null = null;
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const row = await db
        .selectFrom("appointments")
        .innerJoin("leads", "leads.id", "appointments.lead_id")
        .innerJoin("customers", "customers.id", "appointments.customer_id")
        .select([
          "appointments.id", "appointments.scheduled_at",
          "appointments.duration_mins", "appointments.development",
          "appointments.address", "appointments.notes", "appointments.status",
          "appointments.google_event_id", "appointments.updated_at",
          "leads.id as lead_id", "leads.lead_ref", "leads.quotation_breakdown",
          "customers.name as customer_name", "customers.mobile as customer_mobile",
        ])
        .where("appointments.id", "=", appointmentId)
        .executeTakeFirstOrThrow();
      observedUpdatedAt = row.updated_at;

      if (row.status === "cancelled" || row.status === "no_show") {
        if (!isCalendarConfigured()) throw new Error(CALENDAR_NOT_CONFIGURED);
        const ids = new Set([
          ...(row.google_event_id ? [row.google_event_id] : []),
          appointmentCalendarEventId(row.id),
        ]);
        for (const eventId of ids) await deleteEvent(eventId);
        const updated = await db.updateTable("appointments").set({
          google_event_id: null, google_sync_state: "synced", google_sync_error: null,
        }).where("id", "=", appointmentId)
          .where("updated_at", "=", row.updated_at).returning("id").executeTakeFirst();
        if (updated) return { ok: true };
        continue;
      }

      if (!isCalendarConfigured()) throw new Error(CALENDAR_NOT_CONFIGURED);
      const event = buildConsultationEvent({
        customerName: row.customer_name, customerMobile: row.customer_mobile,
        development: row.development, address: row.address, notes: row.notes,
        quotationBreakdown: row.quotation_breakdown, leadRef: row.lead_ref,
        leadId: row.lead_id, scheduledAt: new Date(row.scheduled_at),
        durationMins: row.duration_mins,
        appUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "",
      });

      let eventId = row.google_event_id;
      if (eventId) {
        try {
          await patchEvent(eventId, event);
        } catch (error) {
          if (!(error instanceof CalendarApiError) || ![404, 410].includes(error.status)) throw error;
          eventId = await createIdempotentEvent(row.id, event);
        }
      } else {
        eventId = await createIdempotentEvent(row.id, event);
      }
      const updated = await db.updateTable("appointments").set({
        google_event_id: eventId, google_sync_state: "synced", google_sync_error: null,
      }).where("id", "=", appointmentId)
        .where("updated_at", "=", row.updated_at).returning("id").executeTakeFirst();
      if (updated) return { ok: true };
    }
    throw new Error("Appointment changed repeatedly during Calendar sync");
  } catch (error) {
    const message = errorMessage(error);
    if (!observedUpdatedAt) return { ok: false, error: message };
    await db.updateTable("appointments").set({
      google_sync_state: "failed",
      google_sync_error: message,
    }).where("id", "=", appointmentId)
      .where("updated_at", "=", observedUpdatedAt).execute();
    return { ok: false, error: message };
  }
}

/** Force-removes an appointment's event, regardless of appointment status. */
export async function unsyncAppointment(
  appointmentId: string,
): Promise<CalendarSyncResult> {
  const row = await db.selectFrom("appointments")
    .select(["google_event_id", "google_sync_state", "google_sync_error"])
    .where("id", "=", appointmentId)
    .executeTakeFirst();
  if (!row) return { ok: true };

  // No configured Calendar and no evidence that an event was ever created is
  // already the desired state. A stored id, however, must be retained for a
  // later retry instead of being silently discarded by a hard delete.
  if (!isCalendarConfigured()) {
    if (!row.google_event_id &&
        (row.google_sync_state === "synced" ||
          (row.google_sync_state === "failed" &&
            row.google_sync_error === CALENDAR_NOT_CONFIGURED))) {
      return { ok: true };
    }
    const message = CALENDAR_NOT_CONFIGURED;
    await db.updateTable("appointments").set({
      google_sync_state: "failed",
      google_sync_error: message,
    }).where("id", "=", appointmentId).execute();
    return { ok: false, error: message };
  }

  try {
    const ids = new Set([
      ...(row.google_event_id ? [row.google_event_id] : []),
      appointmentCalendarEventId(appointmentId),
    ]);
    for (const eventId of ids) await deleteEvent(eventId);
    await db.updateTable("appointments").set({
      google_event_id: null,
      google_sync_state: "synced",
      google_sync_error: null,
    }).where("id", "=", appointmentId).execute();
    return { ok: true };
  } catch (error) {
    const message = errorMessage(error);
    await db.updateTable("appointments").set({
      google_sync_state: "failed",
      google_sync_error: message,
    }).where("id", "=", appointmentId).execute();
    return { ok: false, error: message };
  }
}
