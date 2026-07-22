import { describe, expect, it } from "vitest";

import { quoteStaleness } from "./quote-staleness";

describe("quoteStaleness", () => {
  it("flags an order as stale when the live calc has drifted from the locked baseline", () => {
    // DW-2026-0005: locked at $1,436 (old track-in-quote calc), now calculates
    // to $1,276 after the track-cost-only fix.
    const s = quoteStaleness(143600, 127600);
    expect(s.isStale).toBe(true);
    expect(s.baselineCents).toBe(143600);
    expect(s.liveCents).toBe(127600);
  });

  it("is not stale when the live calc still matches the baseline", () => {
    const s = quoteStaleness(127600, 127600);
    expect(s.isStale).toBe(false);
  });

  it("never flags stale when there is no baseline (nothing was locked)", () => {
    const s = quoteStaleness(null, 127600);
    expect(s.isStale).toBe(false);
    expect(s.baselineCents).toBeNull();
  });

  it("does not false-flag a deliberate manual price: staleness tracks the calc baseline, not the agreed price", () => {
    // Baseline = what the calc said when quoted ($1,276); the agreed price may
    // be a negotiated number, but staleness only compares baseline vs live.
    // Calc unchanged → not stale, regardless of the agreed price.
    const s = quoteStaleness(127600, 127600);
    expect(s.isStale).toBe(false);
  });
});
