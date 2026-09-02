"use client";

import { CalendarDays, Check, Copy, X } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import {
  cancelFulfilmentArrangement,
  retryFulfilmentSync,
  saveFulfilmentArrangement,
} from "@/lib/actions/fulfilment";
import { CALENDAR_NOT_CONFIGURED } from "@/lib/calendar/messages";
import type { GoogleSyncState } from "@/lib/db/schema";

type Arrangement = {
  scheduled_at: Date | string;
  duration_mins: number;
  address: string;
  google_event_id: string | null;
  google_sync_state: GoogleSyncState;
  google_sync_error: string | null;
  cancelled_at: Date | string | null;
  cancellation_reason: string | null;
};

type Props = {
  orderId: string;
  arrangement: Arrangement | null;
  summaryText: string | null;
  defaultAddress: string;
  canManage: boolean;
  canRetrySync: boolean;
  calendarConfigured: boolean;
};

const SG_DATETIME = new Intl.DateTimeFormat("en-SG", {
  timeZone: "Asia/Singapore",
  dateStyle: "full",
  timeStyle: "short",
});

function sgInputParts(value: Date | string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    time: `${part("hour")}:${part("minute")}`,
  };
}

export function FulfilmentArrangementCard({
  orderId,
  arrangement,
  summaryText,
  defaultAddress,
  canManage,
  canRetrySync,
  calendarConfigured,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [pending, start] = useTransition();
  const [copied, setCopied] = useState(false);
  const activeArrangement = arrangement?.cancelled_at ? null : arrangement;
  const initial = activeArrangement
    ? sgInputParts(activeArrangement.scheduled_at)
    : null;

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    start(async () => {
      try {
        await saveFulfilmentArrangement({
          order_id: orderId,
          date: data.get("date"),
          time: data.get("time"),
          duration_mins: data.get("duration_mins"),
          address: data.get("address"),
        });
        toast.success(
          activeArrangement ? "Installation rescheduled" : "Installation booked",
        );
        setOpen(false);
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not save booking");
      }
    });
  }

  function cancelBooking(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    start(async () => {
      try {
        await cancelFulfilmentArrangement({
          order_id: orderId,
          reason: data.get("reason"),
        });
        toast.success("Installation cancelled");
        setCancelOpen(false);
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Could not cancel installation",
        );
      } finally {
        router.refresh();
      }
    });
  }

  async function copyDetails() {
    if (!summaryText) return;
    try {
      await navigator.clipboard.writeText(summaryText);
      setCopied(true);
      toast.success("Installation details copied");
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Could not copy installation details");
    }
  }

  const notConfigured =
    arrangement?.google_sync_state === "failed" &&
    arrangement.google_sync_error === CALENDAR_NOT_CONFIGURED &&
    !calendarConfigured;
  const syncFailed = arrangement?.google_sync_state === "failed" && !notConfigured;

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-teal-600" aria-hidden="true" />
            <h2 className="text-base font-semibold text-slate-900">
              Fulfillment Arrangement
            </h2>
          </div>
          {activeArrangement ? (
            <>
              <p className="mt-2 text-sm font-medium text-slate-900">
                {SG_DATETIME.format(new Date(activeArrangement.scheduled_at))}
              </p>
              <p className="mt-0.5 text-sm text-slate-500">
                {activeArrangement.duration_mins} min · {activeArrangement.address}
              </p>
              {activeArrangement.google_sync_state === "synced" &&
              activeArrangement.google_event_id ? (
                <span className="mt-2 inline-flex items-center gap-1 rounded bg-teal-50 px-2 py-1 text-xs font-medium text-teal-700">
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  Synced to shared calendar
                </span>
              ) : null}
            </>
          ) : arrangement?.cancelled_at ? (
            <>
              <p className="mt-2 text-sm font-medium text-slate-700">
                Installation cancelled
              </p>
              <p className="mt-0.5 text-sm text-slate-500">
                {arrangement.cancellation_reason}
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm text-slate-500">
              Book the installation block and prepare the installer handoff.
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {activeArrangement && summaryText ? (
            <Button type="button" variant="outline" size="sm" onClick={copyDetails} className="min-h-11 sm:min-h-8">
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? "Copied" : "Copy details"}
            </Button>
          ) : null}
          {canManage ? (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger className="inline-flex min-h-11 items-center justify-center rounded bg-teal-600 px-3 text-sm font-medium text-white outline-none hover:bg-teal-700 focus-visible:ring-2 focus-visible:ring-teal-500 sm:min-h-8">
                {activeArrangement ? "Reschedule" : "Arrange installation"}
              </DialogTrigger>
              <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                  <DialogTitle>
                    {activeArrangement ? "Reschedule installation" : "Arrange installation"}
                  </DialogTitle>
                  <DialogDescription>
                    Saves the booking here, then syncs it to the shared calendar.
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={submit} className="space-y-4">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div>
                      <Label htmlFor="fulfilment-date">Date</Label>
                      <Input id="fulfilment-date" name="date" type="date" required defaultValue={initial?.date} className="mt-1" />
                    </div>
                    <div>
                      <Label htmlFor="fulfilment-time">Time</Label>
                      <Input id="fulfilment-time" name="time" type="time" required defaultValue={initial?.time} className="mt-1" />
                    </div>
                    <div>
                      <Label htmlFor="fulfilment-duration">Duration (minutes)</Label>
                      <Input id="fulfilment-duration" name="duration_mins" type="number" min={15} max={480} step={15} required defaultValue={activeArrangement?.duration_mins ?? 60} className="mt-1" />
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="fulfilment-address">Installation address</Label>
                    <Input id="fulfilment-address" name="address" required defaultValue={activeArrangement?.address ?? defaultAddress} className="mt-1" />
                  </div>
                  <p className="text-xs text-slate-500">Times use Singapore time.</p>
                  <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
                    <Button type="submit" disabled={pending} className="bg-teal-600 text-white hover:bg-teal-700">
                      {pending ? "Saving…" : activeArrangement ? "Save new time" : "Book installation"}
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          ) : null}
          {canManage && activeArrangement ? (
            <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
              <DialogTrigger className="inline-flex min-h-11 items-center justify-center gap-1 rounded border border-red-300 bg-white px-3 text-sm font-medium text-red-700 outline-none hover:bg-red-50 focus-visible:ring-2 focus-visible:ring-red-500 sm:min-h-8">
                <X className="h-4 w-4" aria-hidden="true" />
                Cancel installation
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Cancel installation</DialogTitle>
                  <DialogDescription>
                    This keeps an audit record, removes the shared Calendar event,
                    and returns the order to Delivered &amp; Checked.
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={cancelBooking} className="space-y-4">
                  <div>
                    <Label htmlFor="fulfilment-cancellation-reason">
                      Cancellation reason
                    </Label>
                    <Textarea
                      id="fulfilment-cancellation-reason"
                      name="reason"
                      required
                      maxLength={1000}
                      className="mt-1"
                    />
                  </div>
                  <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <Button type="button" variant="ghost" onClick={() => setCancelOpen(false)} disabled={pending}>
                      Keep booking
                    </Button>
                    <Button type="submit" variant="destructive" disabled={pending}>
                      {pending ? "Cancelling…" : "Cancel installation"}
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          ) : null}
        </div>
      </div>

      {notConfigured ? (
        <p className="mt-3 text-xs text-slate-500">
          Calendar not configured — the installation change is saved here but
          could not be reconciled with Google.
        </p>
      ) : null}
      {syncFailed ? (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3">
          <p className="text-sm font-medium text-red-800">Calendar sync failed</p>
          <p className="mt-0.5 text-xs text-red-700">
            The installation is saved. {arrangement.google_sync_error}
          </p>
          {canRetrySync ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              className="mt-2 border-red-300 bg-white text-red-800 hover:bg-red-100"
              onClick={() =>
                start(async () => {
                  try {
                    await retryFulfilmentSync({ order_id: orderId });
                    toast.success("Synced to calendar");
                    router.refresh();
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : "Retry failed");
                  } finally {
                    router.refresh();
                  }
                })
              }
            >
              {pending ? "Retrying…" : "Retry calendar sync"}
            </Button>
          ) : null}
        </div>
      ) : null}

      {summaryText ? (
        <details className="mt-4 rounded-md border border-slate-200 bg-slate-50">
          <summary className="flex min-h-11 cursor-pointer items-center px-3 py-2 text-sm font-medium text-slate-700">
            Preview installation details
          </summary>
          <pre className="overflow-x-auto whitespace-pre-wrap border-t border-slate-200 px-3 py-3 font-sans text-sm leading-6 text-slate-700">
            {summaryText}
          </pre>
        </details>
      ) : null}
    </section>
  );
}
