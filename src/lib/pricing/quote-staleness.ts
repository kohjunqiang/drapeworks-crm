// Staleness of a locked quote against the live calculation.
//
// A quoted order's price is deliberately FROZEN at quote time (it's the price
// agreed with the customer, backing a deposit). `price_calc_at_quote_cents`
// records what the calculator produced at that moment — the baseline. When the
// calculator's inputs later change (FX, fabric cost, pricing rules), the live
// result drifts from that baseline. We surface that drift instead of silently
// showing two different numbers.
//
// Staleness compares baseline-vs-live, NOT agreed-price-vs-live — so a
// deliberate manual/negotiated price never false-flags; only an actual change
// in the calculation does.

export type QuoteStaleness = {
  isStale: boolean;
  baselineCents: number | null; // calc value captured when the quote was locked
  liveCents: number; // what the calc produces now
};

export function quoteStaleness(
  baselineCalcCents: number | null,
  liveCents: number,
): QuoteStaleness {
  return {
    isStale: baselineCalcCents != null && baselineCalcCents !== liveCents,
    baselineCents: baselineCalcCents,
    liveCents,
  };
}
