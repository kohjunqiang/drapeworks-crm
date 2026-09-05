"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import {
  acknowledgeQuoteDrift,
  requoteOrder,
} from "@/lib/actions/orders";
import { formatSGD } from "@/lib/money";

// Shown on the order detail Payment card when the calculator has drifted from
// the price the order was locked at. Lets the user re-lock to the current calc
// in one click. Until then the frozen (agreed) price stays as-is.
export function RequoteBanner({
  orderId,
  lockedCents,
  liveCents,
  depositCents,
}: {
  orderId: string;
  lockedCents: number;
  liveCents: number;
  depositCents: number;
}) {
  const [pending, startTransition] = useTransition();

  function requote() {
    const nextBalance = Math.max(liveCents - depositCents, 0);
    if (
      !window.confirm(
        `Update the agreed customer price from ${formatSGD(lockedCents)} to ${formatSGD(liveCents)}?\n\nDeposit stays ${formatSGD(depositCents)}.\nBalance changes to ${formatSGD(nextBalance)}.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      try {
        await requoteOrder(orderId);
        toast.success(`Re-quoted to ${formatSGD(liveCents)}`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Re-quote failed");
      }
    });
  }

  function keepAgreedPrice() {
    startTransition(async () => {
      try {
        await acknowledgeQuoteDrift(orderId);
        toast.success(`Kept agreed price at ${formatSGD(lockedCents)}`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not acknowledge pricing");
      }
    });
  }

  return (
    <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3">
      <p className="text-xs font-medium text-amber-900">
        Pricing inputs changed. The customer is still charged{" "}
        {formatSGD(lockedCents)}.
      </p>
      <p className="mt-1 text-xs text-amber-800">
        Keep the agreed price to dismiss this update, or update the customer
        price to {formatSGD(liveCents)}.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={keepAgreedPrice}
          disabled={pending}
          className="rounded border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
        >
          {pending ? "Saving…" : "Keep agreed price"}
        </button>
        <button
          type="button"
          onClick={requote}
          disabled={pending}
          className="rounded bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:bg-slate-300"
        >
          {pending
            ? "Saving…"
            : `Update agreed price to ${formatSGD(liveCents)}`}
        </button>
      </div>
      <p className="mt-1.5 text-[11px] text-amber-700">
        Keeping it does not change the price, deposit or balance.
      </p>
    </div>
  );
}
