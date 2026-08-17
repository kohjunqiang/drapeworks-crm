"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { advanceOrderStatus } from "@/lib/actions/status";

type Props = {
  orderId: string;
  atEnd: boolean;
  nextLabel?: string;
  /** Overrides the generic "Advance →" wording. Used at order_recorded, where
   *  the action is specifically "the deposit has arrived". */
  ctaLabel?: string;
};

export function AdvanceStatusButton({
  orderId,
  atEnd,
  nextLabel,
  ctaLabel,
}: Props) {
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");

  function submit() {
    startTransition(async () => {
      try {
        await advanceOrderStatus({ orderId, note: note || undefined });
        toast.success(
          nextLabel ? `Advanced to ${nextLabel}` : "Status advanced",
        );
        setOpen(false);
        setNote("");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Advance failed");
      }
    });
  }

  if (atEnd) {
    return (
      <button
        type="button"
        disabled
        className="px-3 py-1.5 text-xs sm:text-sm bg-slate-300 text-white rounded font-medium cursor-not-allowed"
      >
        Completed
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={pending}
        className="px-3 py-1.5 text-xs sm:text-sm bg-teal-600 hover:bg-teal-700 disabled:bg-slate-300 text-white rounded font-medium"
      >
        {pending ? "Saving…" : (ctaLabel ?? "Advance →")}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {ctaLabel ?? (nextLabel ? `Advance to ${nextLabel}` : "Advance status")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <label className="block text-xs font-medium text-slate-600">
              Note (optional)
            </label>
            <textarea
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. handed to KH Logistics, tracking #KH-88273"
              className="w-full px-3 py-2 border border-slate-200 rounded text-sm focus:outline-none focus:border-teal-500 bg-white"
            />
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={pending}
                className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-900"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={pending}
                className="px-4 py-1.5 text-sm bg-teal-600 hover:bg-teal-700 disabled:bg-slate-300 text-white rounded font-medium"
              >
                {pending ? "Saving…" : (ctaLabel ?? "Advance")}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
