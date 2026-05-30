"use client";

import { useFormContext, useWatch } from "react-hook-form";

import type { OrderEditInput } from "@/lib/validation/order";

const INPUT_CLS =
  "w-full pl-7 pr-3 py-2 border border-slate-200 rounded text-sm focus:outline-none focus:border-teal-500 bg-white";

export function PricingSection() {
  const { control, register, setValue } = useFormContext<OrderEditInput>();

  const quotedCents = useWatch({ control, name: "order.price_quoted_cents" }) ?? 0;
  const depositCents = useWatch({ control, name: "order.deposit_cents" }) ?? 0;
  const balanceCents = Math.max(quotedCents - depositCents, 0);

  function handleDollarInput(
    field: "order.price_quoted_cents" | "order.deposit_cents",
    value: string,
  ) {
    const num = value === "" ? 0 : parseFloat(value);
    setValue(field, Number.isFinite(num) ? Math.round(num * 100) : 0, {
      shouldValidate: false,
      shouldDirty: true,
    });
  }

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
          <div className="relative">
            <span className="absolute left-3 top-2 text-slate-400 text-sm">
              $
            </span>
            <input
              type="number"
              step="0.01"
              min="0"
              placeholder="0"
              defaultValue={quotedCents ? (quotedCents / 100).toFixed(2) : ""}
              onChange={(e) =>
                handleDollarInput("order.price_quoted_cents", e.target.value)
              }
              className={INPUT_CLS}
            />
            <input
              type="hidden"
              {...register("order.price_quoted_cents", { valueAsNumber: true })}
            />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Deposit collected
          </label>
          <div className="relative">
            <span className="absolute left-3 top-2 text-slate-400 text-sm">
              $
            </span>
            <input
              type="number"
              step="0.01"
              min="0"
              placeholder="0"
              defaultValue={depositCents ? (depositCents / 100).toFixed(2) : ""}
              onChange={(e) =>
                handleDollarInput("order.deposit_cents", e.target.value)
              }
              className={INPUT_CLS}
            />
            <input
              type="hidden"
              {...register("order.deposit_cents", { valueAsNumber: true })}
            />
          </div>
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
    </section>
  );
}
