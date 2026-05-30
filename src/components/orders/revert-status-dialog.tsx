"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { revertOrderStatus } from "@/lib/actions/status";

type Props = {
  orderId: string;
  prevLabel: string;
};

export function RevertStatusDialog({ orderId, prevLabel }: Props) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();

  function submit() {
    const trimmed = reason.trim();
    if (!trimmed) {
      toast.error("Reason required");
      return;
    }
    startTransition(async () => {
      try {
        await revertOrderStatus({ orderId, reason: trimmed });
        toast.success(`Reverted to ${prevLabel}`);
        setOpen(false);
        setReason("");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Revert failed");
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-slate-500 hover:text-red-600"
      >
        ← Revert status
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Revert to {prevLabel}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-slate-500">
              This will record a backward step in the timeline with the reason
              you provide.
            </p>
            <label className="block text-xs font-medium text-slate-600">
              Reason
            </label>
            <textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. delivery rejected at site, returning to logistic stage"
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
                className="px-4 py-1.5 text-sm bg-red-600 hover:bg-red-700 disabled:bg-slate-300 text-white rounded font-medium"
              >
                {pending ? "Reverting…" : "Revert"}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
