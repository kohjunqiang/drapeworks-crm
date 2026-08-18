import { describe, expect, it } from "vitest";

import { shouldAutofillPrice } from "./use-quote-autofill";

// The bug this pins: a manual price used to survive only until the next change
// to the calculated quote, and on the edit screen the quote settles just after
// load — so a saved manual price was overwritten before anyone touched the
// form, and the save then wrote back the value the user thought they'd changed.
describe("shouldAutofillPrice", () => {
  it("fills an empty field — a new consultation is not a human decision", () => {
    expect(shouldAutofillPrice(0, null)).toBe(true);
  });

  it("keeps tracking the quote while nobody has intervened", () => {
    // The calculator wrote 15600; the quote has since moved. Still ours.
    expect(shouldAutofillPrice(15600, 15600)).toBe(true);
  });

  it("stops the moment a human types a different price", () => {
    expect(shouldAutofillPrice(30000, 15600)).toBe(false);
  });

  // The edit-screen case. The form loads an order priced by hand, the live
  // quote arrives a moment later, and the calculator must not claim the field.
  it("leaves a loaded price alone, having written nothing itself", () => {
    expect(shouldAutofillPrice(30000, null)).toBe(false);
  });

  it("never reclaims the field once a human has it", () => {
    // Even if the human happens to type what the calculator would have said,
    // the next divergence must not overwrite them.
    expect(shouldAutofillPrice(20000, 15600)).toBe(false);
  });

  it("treats a cleared field as available again", () => {
    expect(shouldAutofillPrice(0, 15600)).toBe(true);
  });
});
