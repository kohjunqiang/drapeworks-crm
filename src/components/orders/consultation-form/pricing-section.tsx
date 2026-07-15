"use client";

import { useState } from "react";
import { useFormContext, useWatch } from "react-hook-form";

import type { OrderEditInput } from "@/lib/validation/order";

const INPUT_CLS =
  "w-full pl-7 pr-3 py-2 border border-slate-200 rounded text-sm focus:outline-none focus:border-teal-500 bg-white";

// A dollar input whose displayed text stays editable while still reflecting
// values set externally (the live quote auto-fills these fields). We keep a
// local string so typing "12." works, and re-sync from `cents` only when an
// outside change no longer matches what's typed.
function DollarInput({
  cents,
  onCents,
}: {
  cents: number;
  onCents: (cents: number) => void;
}) {
  const [text, setText] = useState(cents ? (cents / 100).toFixed(2) : "");
  const [prevCents, setPrevCents] = useState(cents);

  // Re-sync the displayed text when `cents` changes from the outside (the live
  // quote auto-filling), but not while the user is mid-type. This "adjust state
  // during render" pattern is React's recommended alternative to an effect.
  if (cents !== prevCents) {
    setPrevCents(cents);
    const current = text === "" ? 0 : Math.round(parseFloat(text) * 100);
    if (current !== cents) setText(cents ? (cents / 100).toFixed(2) : "");
  }

  return (
    <div className="relative">
      <span className="absolute left-3 top-2 text-slate-400 text-sm">$</span>
      <input
        type="number"
        step="0.01"
        min="0"
        placeholder="0"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const num = e.target.value === "" ? 0 : parseFloat(e.target.value);
          onCents(Number.isFinite(num) ? Math.round(num * 100) : 0);
        }}
        className={INPUT_CLS}
      />
    </div>
  );
}

export function PricingSection() {
  const { control, register, setValue } = useFormContext<OrderEditInput>();

  const quotedCents = useWatch({ control, name: "order.price_quoted_cents" }) ?? 0;
  const depositCents = useWatch({ control, name: "order.deposit_cents" }) ?? 0;
  const balanceCents = Math.max(quotedCents - depositCents, 0);

  const setCents = (
    field: "order.price_quoted_cents" | "order.deposit_cents",
    cents: number,
  ) => setValue(field, cents, { shouldValidate: false, shouldDirty: true });

  return (
    <section className="bg-white rounded-lg border border-slate-200 p-4 sm:p-6 mb-4">
      <h2 className="text-base font-semibold text-slate-900 mb-4">
        Pricing &amp; payment
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Price quoted (SGD)
          </label>
          <DollarInput
            cents={quotedCents}
            onCents={(c) => setCents("order.price_quoted_cents", c)}
          />
          <input
            type="hidden"
            {...register("order.price_quoted_cents", { valueAsNumber: true })}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Deposit collected
          </label>
          <DollarInput
            cents={depositCents}
            onCents={(c) => setCents("order.deposit_cents", c)}
          />
          <input
            type="hidden"
            {...register("order.deposit_cents", { valueAsNumber: true })}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Balance due
          </label>
          <div className="relative">
            <span className="absolute left-3 top-2 text-slate-400 text-sm">
              $
            </span>
            <input
              type="text"
              readOnly
              value={(balanceCents / 100).toFixed(2)}
              className="w-full pl-7 pr-3 py-2 border border-slate-200 rounded text-sm bg-slate-50 text-slate-700"
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 mt-3">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Freight
          </label>
          <select
            {...register("order.freight_mode")}
            className="w-full px-3 py-2 border border-slate-200 rounded text-sm bg-white"
          >
            <option value="air">Air</option>
            <option value="sea">Sea</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Sales channel
          </label>
          <select
            {...register("order.channel")}
            className="w-full px-3 py-2 border border-slate-200 rounded text-sm bg-white"
          >
            <option value="standard">Standard (35% floor)</option>
            <option value="carousell">Carousell (30% floor)</option>
          </select>
        </div>
      </div>

      <p className="text-xs text-slate-400 mt-2">
        Price quoted &amp; deposit auto-fill from the live quote below — edit to
        override.
      </p>
    </section>
  );
}
