"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { rescheduleAppointment } from "@/lib/actions/appointments";

const LABEL = "text-xs font-medium uppercase tracking-wide text-slate-500";
const FIELD = "mt-1 h-9 border-slate-200";

/**
 * Moving an existing appointment, as opposed to booking a new one.
 *
 * Only the three time fields: the customer, address and notes are already
 * settled and re-asking for them invites a typo that silently rewrites the
 * record. `rescheduleAppointment` patches the existing calendar event rather
 * than creating a second one, and carries the lead's action date along with
 * the new date so the queue does not keep showing the old one.
 */
export function RescheduleDialog({
  appointmentId,
  scheduledAt,
  durationMins,
}: {
  appointmentId: string;
  scheduledAt: Date | string;
  durationMins: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  // Prefill from the current booking in SINGAPORE time. toISOString() would
  // hand back UTC and show a 10:30 consultation as 02:30 — the same class of
  // bug the engine's SgDate type exists to prevent.
  const current = new Date(scheduledAt);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(current);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const currentDate = `${part("year")}-${part("month")}-${part("day")}`;
  // en-CA renders midnight as "24" rather than "00"; Chrome's time input
  // rejects that outright and shows an empty field.
  const currentTime = `${part("hour") === "24" ? "00" : part("hour")}:${part("minute")}`;

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    start(async () => {
      try {
        await rescheduleAppointment({
          id: appointmentId,
          date: formData.get("date"),
          time: formData.get("time"),
          duration_mins: String(formData.get("duration_mins") ?? "").trim() || undefined,
        });
        toast.success("Appointment rescheduled");
        setOpen(false);
        router.refresh();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Could not reschedule",
        );
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="inline-flex items-center justify-center rounded border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 outline-none focus-visible:ring-2 focus-visible:ring-teal-500">
        Reschedule
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reschedule consultation</DialogTitle>
          <DialogDescription>
            Moves the existing calendar event. No second event is created.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <Label htmlFor="reschedule-date" className={LABEL}>
                Date
              </Label>
              <Input
                type="date"
                id="reschedule-date"
                name="date"
                required
                defaultValue={currentDate}
                className={FIELD}
              />
            </div>
            <div>
              <Label htmlFor="reschedule-time" className={LABEL}>
                Time
              </Label>
              <Input
                type="time"
                id="reschedule-time"
                name="time"
                required
                defaultValue={currentTime}
                className={FIELD}
              />
            </div>
            <div>
              <Label htmlFor="reschedule-duration" className={LABEL}>
                Minutes
              </Label>
              <Input
                type="number"
                id="reschedule-duration"
                name="duration_mins"
                min={15}
                max={480}
                step={15}
                defaultValue={durationMins}
                className={FIELD}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={pending}
              className="bg-teal-600 hover:bg-teal-700 text-white"
            >
              {pending ? "Rescheduling…" : "Reschedule"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
