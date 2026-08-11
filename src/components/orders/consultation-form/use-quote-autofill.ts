"use client";

import { useEffect } from "react";
import { useFormContext } from "react-hook-form";

import type { ConsultationShellShape } from "./form-shapes";

// Auto-fill the order's quoted price + 50% deposit from the live quote.
//
// Extracted so the curtain and mesh quote panels share one owner of the rule.
// Duplicating it would give the 50% deposit two definitions that drift the
// first time one of them changes.
//
// Only fires when there's something priced, so it never wipes a manual entry
// with $0. The fields stay editable — a manual override sticks until the next
// change to the calculated value.
export function useQuoteAutofill(discountedSaleSgdCents: number): void {
  const { setValue } = useFormContext<ConsultationShellShape>();

  useEffect(() => {
    if (discountedSaleSgdCents > 0) {
      setValue("order.price_quoted_cents", discountedSaleSgdCents, {
        shouldDirty: true,
      });
      setValue("order.deposit_cents", Math.round(discountedSaleSgdCents / 2), {
        shouldDirty: true,
      });
    }
  }, [discountedSaleSgdCents, setValue]);
}
