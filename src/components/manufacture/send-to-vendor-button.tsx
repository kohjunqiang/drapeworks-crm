"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { markOrderSentToVendor } from "@/lib/actions/manufacture";

export function SendToVendorButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      try {
        await markOrderSentToVendor(orderId);
        toast.success("Order marked as Sent to Vendor");
        setOpen(false);
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not update the order");
      }
    });
  }

  return <>
    <button type="button" onClick={() => setOpen(true)}
      className="px-4 py-2 rounded bg-orange-600 text-white text-sm font-medium hover:bg-orange-700">
      Mark as sent to vendor
    </button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Confirm vendor handoff</DialogTitle></DialogHeader>
        <p className="text-sm text-slate-700">
          This does not send any files. Confirm only after a person has sent every current
          Day, Night, and Blinds PO, plus the Track Order text where required.
        </p>
        <div className="flex justify-end gap-2 pt-3">
          <button type="button" onClick={() => setOpen(false)} disabled={pending}
            className="px-3 py-1.5 text-sm text-slate-600">Cancel</button>
          <button type="button" onClick={confirm} disabled={pending}
            className="px-4 py-1.5 rounded bg-orange-600 text-white text-sm font-medium disabled:opacity-50">
            {pending ? "Updating…" : "Yes, mark as sent"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
