"use client";

import { useEffect, useRef } from "react";
import { useFormContext } from "react-hook-form";

import type { ConsultationShellShape } from "./form-shapes";

/**
 * Should the calculator write the quoted price, or has a human claimed it?
 *
 * The rule: the calculator owns the field until somebody types in it, and then
 * it never touches it again.
 *
 * `lastWritten` is what this hook last put there. If the field still holds that
 * value, nobody has intervened and the calculator may keep it current. If it
 * holds anything else, a person put it there — either by typing, or by the form
 * loading an order that was priced by hand earlier — and the calculator must
 * leave it alone.
 *
 * Zero is the exception: an unpriced new consultation is not a human decision,
 * it is an empty field waiting for the first quote.
 *
 * Pure and exported so the rule can be tested. It used to live inline and read
 * "overwrite whenever the calculated value changes", which meant a manual price
 * survived only until the next keystroke that moved the quote anywhere in the
 * form — and on the edit screen the quote settles just after load, so a saved
 * manual price was overwritten before the user had touched anything. Both read
 * as "my price didn't save".
 */
export function shouldAutofillPrice(
  current: number,
  lastWritten: number | null,
): boolean {
  if (current === 0) return true;
  return lastWritten !== null && current === lastWritten;
}

// Auto-fill the order's quoted price + 50% deposit from the live quote.
//
// Extracted so the curtain and mesh quote panels share one owner of the rule.
// Duplicating it would give the 50% deposit two definitions that drift the
// first time one of them changes.
export function useQuoteAutofill(discountedSaleSgdCents: number): void {
  const { setValue, getValues } = useFormContext<ConsultationShellShape>();
  // What this hook last wrote. null until it has written anything, which is
  // also how an order loaded with a hand-set price stays hand-set.
  const lastWritten = useRef<number | null>(null);

  useEffect(() => {
    // Nothing priced yet: never wipe a manual entry with $0.
    if (discountedSaleSgdCents <= 0) return;

    const current = getValues("order.price_quoted_cents") ?? 0;
    if (!shouldAutofillPrice(current, lastWritten.current)) return;

    lastWritten.current = discountedSaleSgdCents;
    setValue("order.price_quoted_cents", discountedSaleSgdCents, {
      shouldDirty: true,
    });
    // The deposit follows the price only while the calculator owns the price.
    // Once a human sets the price, they own the deposit too — otherwise typing
    // a negotiated total would silently re-derive a deposit they did not agree.
    setValue("order.deposit_cents", Math.round(discountedSaleSgdCents / 2), {
      shouldDirty: true,
    });
  }, [discountedSaleSgdCents, setValue, getValues]);
}
