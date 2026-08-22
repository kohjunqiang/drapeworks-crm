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
import { Textarea } from "@/components/ui/textarea";
import { bookAppointment } from "@/lib/actions/appointments";

import { CustomerPicker, type CustomerChoice } from "./customer-picker";

const LABEL = "text-xs font-medium uppercase tracking-wide text-slate-500";
const FIELD = "mt-1 h-9 border-slate-200";

export function BookAppointmentDialog({
  leadId,
  leadName,
  leadMobile,
  development,
}: {
  leadId: string;
  leadName: string;
  leadMobile: string | null;
  development: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [customer, setCustomer] = useState<CustomerChoice>({
    mode: "new",
    name: leadName,
    mobile: leadMobile ?? "",
  });

  // Deliberately onSubmit rather than <form action={fn}>: React resets a form
  // that has an action prop once the action settles, so a booking rejected for
  // a bad mobile would come back with every field blank.
  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    // "" is what an untouched or cleared field submits, and every one of these
    // is optional — passing the empty string through would store it verbatim
    // and, for duration, coerce to 0 and trip the min(15) rule instead of
    // falling back to the schema's default of 90.
    const opt = (key: string) => String(formData.get(key) ?? "").trim() || undefined;

    start(async () => {
      try {
        await bookAppointment({
          lead_id: leadId,
          date: formData.get("date"),
          time: formData.get("time"),
          duration_mins: opt("duration_mins"),
          development: opt("development"),
          address: opt("address"),
          notes: opt("notes"),
          customer:
            customer.mode === "existing"
              ? { mode: "existing", customer_id: customer.customer_id }
              : {
                  mode: "new",
                  name: customer.name.trim(),
                  mobile: customer.mobile.trim(),
                },
        });
        toast.success("Appointment booked");
        setOpen(false);
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not book");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {/* The trigger renders its own <button>, styled like every other teal CTA
          in the app — same as nav/mobile-menu.tsx and nav/user-menu.tsx. */}
      <DialogTrigger className="inline-flex shrink-0 items-center justify-center gap-2 bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded font-medium text-sm outline-none focus-visible:ring-2 focus-visible:ring-teal-500">
        Book appointment
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Book consultation</DialogTitle>
          <DialogDescription>{leadName}</DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <Label htmlFor="date" className={LABEL}>
                Date
              </Label>
              <Input
                type="date"
                id="date"
                name="date"
                required
                className={FIELD}
              />
            </div>
            <div>
              <Label htmlFor="time" className={LABEL}>
                Time
              </Label>
              <Input
                type="time"
                id="time"
                name="time"
                required
                className={FIELD}
              />
            </div>
            <div>
              <Label htmlFor="duration_mins" className={LABEL}>
                Minutes
              </Label>
              <Input
                type="number"
                id="duration_mins"
                name="duration_mins"
                defaultValue={90}
                min={15}
                max={480}
                step={15}
                className={FIELD}
              />
            </div>
          </div>

          <div>
            <Label htmlFor="development" className={LABEL}>
              Development
            </Label>
            <Input
              id="development"
              name="development"
              defaultValue={development ?? ""}
              className={FIELD}
            />
          </div>

          <div>
            <Label htmlFor="address" className={LABEL}>
              Address
            </Label>
            <Input
              id="address"
              name="address"
              placeholder="Block, street, unit"
              className={FIELD}
            />
          </div>

          <div>
            <Label htmlFor="notes" className={LABEL}>
              Notes
            </Label>
            <Textarea
              id="notes"
              name="notes"
              rows={2}
              className="mt-1 min-h-16 border-slate-200"
            />
          </div>

          <CustomerPicker
            defaultName={leadName}
            defaultMobile={leadMobile}
            value={customer}
            onChange={setCustomer}
          />

          <p className="text-xs text-slate-500">
            Creates an event on the shared Drapeworks calendar. The customer is
            not emailed.
          </p>

          <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2 sm:gap-3 pt-1">
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
              {pending ? "Booking…" : "Book appointment"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
