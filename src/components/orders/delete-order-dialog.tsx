"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { deleteOrder } from "@/lib/actions/orders";

type Props = {
  orderId: string;
  displayId: string;
  customerName: string;
};

export function DeleteOrderDialog({
  orderId,
  displayId,
  customerName,
}: Props) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [pending, startTransition] = useTransition();

  const armed = confirm.trim() === displayId;

  function submit() {
    if (!armed) return;
    startTransition(async () => {
      try {
        await deleteOrder({ orderId, confirmDisplayId: confirm.trim() });
        // deleteOrder redirects; this line typically doesn't execute.
      } catch (e) {
        const msg = e instanceof Error ? e.message : "";
        if (msg === "NEXT_REDIRECT" || msg.includes("NEXT_REDIRECT")) return;
        toast.error(msg || "Delete failed");
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="px-3 py-1.5 text-xs sm:text-sm border border-red-300 text-red-700 rounded hover:bg-red-50"
      >
        Delete
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete order {displayId}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-slate-700">
              This will permanently delete the order for{" "}
              <span className="font-medium">{customerName}</span>, along with
              every room, window, status event, and photo. The customer
              record stays.
            </p>
            <p className="text-xs text-slate-500">
              Type{" "}
              <span className="font-mono font-semibold text-slate-700">
                {displayId}
              </span>{" "}
              to confirm.
            </p>
            <input
              type="text"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder={displayId}
              className="w-full px-3 py-2 border border-slate-200 rounded text-sm focus:outline-none focus:border-red-500 bg-white"
            />
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setConfirm("");
                }}
                disabled={pending}
                className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-900"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={pending || !armed}
                className="px-4 py-1.5 text-sm bg-red-600 hover:bg-red-700 disabled:bg-slate-300 text-white rounded font-medium"
              >
                {pending ? "Deleting…" : "Delete order"}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
