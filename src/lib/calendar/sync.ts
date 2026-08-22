import "server-only";

import { db } from "@/lib/db/kysely";

import { buildConsultationEvent } from "./event";
import {
  createEvent,
  deleteEvent,
  isCalendarConfigured,
  patchEvent,
} from "./google";

/**
 * Pushes an appointment to the shared calendar and records the outcome.
 *
 * Never throws. Sync is a side effect of booking, not part of it — the
 * appointment is already committed by the time this runs, and a Google outage
 * must not be able to lose it. Failures are surfaced in the UI with a retry.
 */
export async function syncAppointment(appointmentId: string): Promise<void> {
  if (!isCalendarConfigured()) {
    await db
      .updateTable("appointments")
      .set({
        google_sync_state: "failed",
        google_sync_error:
          "Google Calendar is not configured on this environment",
      })
      .where("id", "=", appointmentId)
      .execute();
    return;
  }

  try {
    const row = await db
      .selectFrom("appointments")
      .innerJoin("leads", "leads.id", "appointments.lead_id")
      .innerJoin("customers", "customers.id", "appointments.customer_id")
      .select([
        "appointments.id",
        "appointments.scheduled_at",
        "appointments.duration_mins",
        "appointments.development",
        "appointments.address",
        "appointments.notes",
        "appointments.status",
        "appointments.google_event_id",
        "leads.id as lead_id",
        "leads.lead_ref",
        "customers.name as customer_name",
        "customers.mobile as customer_mobile",
      ])
      .where("appointments.id", "=", appointmentId)
      .executeTakeFirstOrThrow();

    // A cancelled appointment has no business on the calendar. Without this
    // guard a retry — or any later sync — resurrects the event that cancelling
    // just deleted.
    if (row.status === "cancelled" || row.status === "no_show") return;

    const event = buildConsultationEvent({
      customerName: row.customer_name,
      customerMobile: row.customer_mobile,
      development: row.development,
      address: row.address,
      notes: row.notes,
      leadRef: row.lead_ref,
      leadId: row.lead_id,
      scheduledAt: new Date(row.scheduled_at),
      durationMins: row.duration_mins,
      appUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "",
    });

    const eventId = row.google_event_id
      ? (await patchEvent(row.google_event_id, event), row.google_event_id)
      : await createEvent(event);

    await db
      .updateTable("appointments")
      .set({
        google_event_id: eventId,
        google_sync_state: "synced",
        google_sync_error: null,
      })
      .where("id", "=", appointmentId)
      .execute();
  } catch (error) {
    await db
      .updateTable("appointments")
      .set({
        google_sync_state: "failed",
        google_sync_error:
          error instanceof Error
            ? error.message.slice(0, 1000)
            : "Unknown error",
      })
      .where("id", "=", appointmentId)
      .execute();
  }
}

/** Removes an appointment's event. Also never throws. */
export async function unsyncAppointment(appointmentId: string): Promise<void> {
  try {
    const row = await db
      .selectFrom("appointments")
      .select("google_event_id")
      .where("id", "=", appointmentId)
      .executeTakeFirst();

    // Never created, so there is nothing to delete — but the state still has
    // to be cleared. An appointment whose sync had failed and is then
    // cancelled would otherwise keep showing "Calendar sync failed — Retry",
    // and Retry now hits the cancelled-status guard and does nothing. Correct
    // behaviour, broken signal.
    if (!row?.google_event_id) {
      await db
        .updateTable("appointments")
        .set({ google_sync_state: "synced", google_sync_error: null })
        .where("id", "=", appointmentId)
        .execute();
      return;
    }

    await deleteEvent(row.google_event_id);
    await db
      .updateTable("appointments")
      .set({
        google_event_id: null,
        // 'synced', not 'pending'. The desired end state — no event — has been
        // reached, so this IS in sync. Marking it pending would read as
        // "waiting to sync" in the UI and let any later syncAppointment
        // recreate the event that was just deleted.
        google_sync_state: "synced",
        google_sync_error: null,
      })
      .where("id", "=", appointmentId)
      .execute();
  } catch (error) {
    await db
      .updateTable("appointments")
      .set({
        google_sync_state: "failed",
        google_sync_error:
          error instanceof Error
            ? error.message.slice(0, 1000)
            : "Unknown error",
      })
      .where("id", "=", appointmentId)
      .execute();
  }
}
