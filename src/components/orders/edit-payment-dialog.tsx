"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { amendOrderPayment } from "@/lib/actions/orders";
import { halfDepositCents } from "@/lib/orders/payment-defaults";

type Props = {
  orderId: string;
  defaultQuotedCents: number;
};

function dollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

function cents(value: string): number | null {
  if (!/^\d+(?:\.\d{0,2})?$/.test(value.trim())) return null;
  return Math.round(Number(value) * 100);
}

export function EditPaymentDialog({
  orderId,
  defaultQuotedCents,
}: Props) {
  const [open, setOpen] = useState(false);
  const [quoted, setQuoted] = useState(dollars(defaultQuotedCents));
  const [deposit, setDeposit] = useState(
    dollars(halfDepositCents(defaultQuotedCents)),
  );
  const [depositEdited, setDepositEdited] = useState(false);
  const [pending, startTransition] = useTransition();

  const parsedQuoted = cents(quoted);
  const parsedDeposit = cents(deposit);
  const valid =
    parsedQuoted != null &&
    parsedDeposit != null &&
    parsedDeposit <= parsedQuoted;

  function show() {
    setQuoted(dollars(defaultQuotedCents));
    setDeposit(dollars(halfDepositCents(defaultQuotedCents)));
    setDepositEdited(false);
    setOpen(true);
  }

  function changeQuoted(value: string) {
    setQuoted(value);
    if (depositEdited) return;
    const amount = cents(value);
    setDeposit(amount == null ? "" : dollars(halfDepositCents(amount)));
  }

  function save() {
    if (!valid || parsedQuoted == null || parsedDeposit == null) return;
    startTransition(async () => {
      try {
        await amendOrderPayment({
          orderId,
          quotedCents: parsedQuoted,
          depositCents: parsedDeposit,
        });
        toast.success("Payment amounts updated");
        setOpen(false);
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Could not update payment",
        );
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={show}
        className="text-xs font-medium text-teal-700 underline hover:text-teal-800"
      >
        Edit
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit payment</DialogTitle>
            <DialogDescription>
              Correct the agreed quote or deposit received. The change will be
              recorded in the order timeline.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <label className="block text-sm font-medium text-slate-700">
              Quoted amount (SGD)
              <input
                type="text"
                inputMode="decimal"
                value={quoted}
                onChange={(event) => changeQuoted(event.target.value)}
                className="mt-1 w-full rounded border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-teal-500"
              />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              Deposit paid (SGD)
              <input
                type="text"
                inputMode="decimal"
                value={deposit}
                onChange={(event) => {
                  setDepositEdited(true);
                  setDeposit(event.target.value);
                }}
                className="mt-1 w-full rounded border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-teal-500"
              />
            </label>
            {!valid && (
              <p className="text-xs text-red-600">
                Enter valid amounts; the deposit cannot exceed the quote.
              </p>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={pending}
                className="px-3 py-2 text-sm text-slate-600 hover:text-slate-900"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={save}
                disabled={pending || !valid}
                className="rounded bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700 disabled:bg-slate-300"
              >
                {pending ? "Saving…" : "Save payment"}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
