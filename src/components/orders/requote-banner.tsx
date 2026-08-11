"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { requoteOrder } from "@/lib/actions/orders";
import { formatSGD } from "@/lib/money";

// Shown on the order detail Payment card when the calculator has drifted from
// the price the order was locked at. Lets the user re-lock to the current calc
// in one click. Until then the frozen (agreed) price stays as-is.
export function RequoteBanner({
  orderId,
  lockedCents,
  liveCents,
}: {
  orderId: string;
  lockedCents: number;
  liveCents: number;
}) {
  const [pending, startTransition] = useTransition();

  function requote() {
    startTransition(async () => {
      try {
        await requoteOrder(orderId);
        toast.success(`Re-quoted to ${formatSGD(liveCents)}`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Re-quote failed");
      }
    });
  }

  return (
    <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3">
      <p className="text-xs text-amber-800">
        ⚠ Pricing has changed since this order was quoted. Locked at{" "}
        <span className="font-semibold">{formatSGD(lockedCents)}</span>, now
        calculates to{" "}
        <span className="font-semibold">{formatSGD(liveCents)}</span>.
      </p>
      <button
        type="button"
        onClick={requote}
        disabled={pending}
        className="mt-2 px-3 py-1.5 text-xs bg-amber-600 hover:bg-amber-700 disabled:bg-slate-300 text-white rounded font-medium"
      >
        {pending ? "Re-quoting…" : `Re-quote to ${formatSGD(liveCents)}`}
      </button>
    </div>
  );
}
