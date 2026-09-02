"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  retryAppointmentSync,
  setAppointmentStatus,
} from "@/lib/actions/appointments";
import { CALENDAR_NOT_CONFIGURED } from "@/lib/calendar/messages";
import type { AppointmentStatus, GoogleSyncState } from "@/lib/db/schema";

import { RescheduleDialog } from "./reschedule-dialog";

export type AppointmentSummary = {
  id: string;
  scheduled_at: Date | string;
  duration_mins: number;
  development: string | null;
  address: string | null;
  notes: string | null;
  status: AppointmentStatus;
  google_event_id: string | null;
  google_sync_state: GoogleSyncState;
  google_sync_error: string | null;
};

const SG_DATETIME = new Intl.DateTimeFormat("en-SG", {
  timeZone: "Asia/Singapore",
  dateStyle: "full",
  timeStyle: "short",
});

const STATUS_LABEL: Record<AppointmentStatus, string> = {
  scheduled: "Scheduled",
  completed: "Completed",
  cancelled: "Cancelled",
  no_show: "No-show",
};

export function AppointmentCard({
  appointment,
  calendarConfigured,
  onChanged,
}: {
  appointment: AppointmentSummary;
  /** Whether the GOOGLE_* vars are set on the server *right now*. */
  calendarConfigured: boolean;
  onChanged?: () => void | Promise<void>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function run(fn: () => Promise<void>, success: string) {
    start(async () => {
      try {
        await fn();
        toast.success(success);
        await onChanged?.();
        router.refresh();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Something went wrong",
        );
      }
    });
  }

  // "Failed" covers two very different things. A real Google error is worth an
  // amber banner and a retry. A missing GOOGLE_* env var is a deployment fact,
  // not an incident — it is the permanent state of local dev, so surfacing it
  // as a failure would put an unfixable alarm on every appointment on screen.
  //
  // `calendarConfigured` is what the server sees now, not what it saw when the
  // row was written. Without it the marker is permanent: this phase ships sync
  // decoupled on purpose, so appointments get booked before the credentials
  // land — and on the day they land, every one of those rows would still read
  // "not configured" and still be denied a Retry. Stranded with no way back
  // short of editing the database.
  const notConfigured =
    appointment.google_sync_state === "failed" &&
    appointment.google_sync_error === CALENDAR_NOT_CONFIGURED &&
    !calendarConfigured;
  const syncFailed =
    appointment.google_sync_state === "failed" && !notConfigured;

  const subtitle = [
    `${appointment.duration_mins} min`,
    appointment.development,
    appointment.address,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Card className="rounded-lg bg-white ring-slate-200">
      <CardContent className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <h2 className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Appointment
            </h2>
            <p className="mt-1 text-lg text-slate-900">
              {SG_DATETIME.format(new Date(appointment.scheduled_at))}
            </p>
            <p className="text-sm text-slate-500">{subtitle}</p>
            {appointment.notes ? (
              <p className="mt-1 text-sm text-slate-600">{appointment.notes}</p>
            ) : null}
          </div>

          <Link
            href={`/orders/new?appointmentId=${appointment.id}`}
            className="inline-flex shrink-0 items-center justify-center gap-2 bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded font-medium text-sm"
          >
            Start consultation
          </Link>
        </div>

        {syncFailed ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
            <p className="text-sm font-medium text-amber-800">
              Calendar sync failed
            </p>
            {/* The booking itself is safe — only the calendar entry is missing. */}
            <p className="mt-0.5 text-xs text-amber-700">
              The appointment is saved. {appointment.google_sync_error}
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                run(
                  () => retryAppointmentSync(appointment.id),
                  "Synced to calendar",
                )
              }
              disabled={pending}
              className="mt-2 border-amber-300 bg-white text-amber-800 hover:bg-amber-100"
            >
              {pending ? "Retrying…" : "Retry"}
            </Button>
          </div>
        ) : null}

        {notConfigured ? (
          <p className="text-xs text-slate-500">
            Calendar not configured — this appointment is saved here but was not
            pushed to Google.
          </p>
        ) : null}

        {/* 'synced' means "the calendar matches what we want", which is also
            true when what we want is NO event: unsyncAppointment deliberately
            lands on 'synced' with a null event id after cancelling or marking
            a no-show, so the stale "sync failed — Retry" alarm clears. A
            no-show keeps its card on screen, so gating only on the state would
            tell the consultant the appointment is "on the shared calendar"
            when the event has just been deleted — or, on an environment with
            no Google credentials, when it was never created at all. */}
        {appointment.google_sync_state === "synced" &&
        appointment.google_event_id ? (
          <p className="text-xs text-slate-500">On the shared calendar.</p>
        ) : null}

        {/* Only a scheduled appointment may transition, and setAppointmentStatus
            refuses anything else. Rendering buttons the server will reject is
            just an error message waiting to happen. */}
        {appointment.status === "scheduled" ? (
          <div className="flex flex-wrap gap-2">
            {/* Same gate as the status buttons: rescheduleAppointment patches
                the Google event in place, and there is no event to move once
                the appointment has been completed, cancelled or no-showed. */}
            <RescheduleDialog
              appointmentId={appointment.id}
              scheduledAt={appointment.scheduled_at}
              durationMins={appointment.duration_mins}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() =>
                run(
                  () =>
                    setAppointmentStatus({
                      id: appointment.id,
                      status: "completed",
                    }),
                  "Marked completed",
                )
              }
            >
              Mark completed
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() =>
                run(
                  () =>
                    setAppointmentStatus({
                      id: appointment.id,
                      status: "no_show",
                    }),
                  "Marked no-show",
                )
              }
            >
              No-show
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              className="text-red-700 hover:bg-red-50"
              onClick={() =>
                run(
                  () =>
                    setAppointmentStatus({
                      id: appointment.id,
                      status: "cancelled",
                    }),
                  "Appointment cancelled",
                )
              }
            >
              Cancel
            </Button>
          </div>
        ) : (
          <p className="text-xs text-slate-500">
            Status: {STATUS_LABEL[appointment.status]}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
