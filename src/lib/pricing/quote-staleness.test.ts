import { describe, expect, it } from "vitest";

import { computeQuote } from "./calculator";
import {
  computeMeshQuote,
  minimumKey,
  type MeshCalcAssumptions,
  type MeshPriceBook,
} from "./mesh-calculator";
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

// ── the Phase 13B regression guard ───────────────────────────────────────
//
// Confirming a manufacturing set re-costs an order off the smaller dimensions
// the vendor is actually cutting. If any of that leaked into the SALE side, the
// recomputed price would drop below the locked baseline and every confirmed
// order would light up "pricing has changed since this order was quoted" — a
// banner no user action could clear.
//
// These run the real engines end to end rather than the pure comparison above,
// because the comparison is not where the bug would be.

const ASSUMPTIONS: MeshCalcAssumptions = {
  fxSgdToRmb: 53000,
  gstBps: 900,
  otherCostBps: 1000,
  groupbuyDiscountBps: 1500,
  styleMultiplier: 20000,
  handymanSingleSgdCents: 6000,
  handymanDoubleSgdCents: 10000,
  handymanBlindsSgdCents: 8000,
  handymanMeshSgdCents: 4500,
  seaFreightRmbCentsPerM3: 40000,
  airFreightRateBps: 6000,
  airFreightFloorRmbCents: 50000,
  airFreightCapRmbCents: 140000,
  trackCostRmbCentsPerM: 2500,
};

const SIGNATURE = { costRmbCents: 5100, saleSgdCents: 9000 };
const BLIND = { costRmbCents: 4000, saleSgdCents: 7000 };

const CAT = "cat-airguard";

const MESH_BOOK: MeshPriceBook = {
  rates: { [CAT]: { costRmbCentsPerSqm: 4000, saleSgdCentsPerSqm: 8000 } },
  colours: { "col-bronze": { costRmbCents: 2000, saleSgdCents: 3500 } },
  bands: [
    { maxWidthCm: 760, singleSystem: "System 68", doubleSystem: "System 55" },
  ],
  doubleSurcharges: {
    "system 55": { costRmbCents: 4000, saleSgdCents: 6000 },
  },
  // 1 m² per leaf, so the small panel below is over the floor as measured and
  // under it as made — the case where the two sides diverge most.
  minimumAreas: { [minimumKey(CAT, "System 68")]: 10_000 },
};

describe("a confirmed manufacturing set does not raise the stale banner", () => {
  it("leaves a curtain + blind order's price exactly where it was quoted", () => {
    const windows = [
      // Widths that straddle a tenth of a metre, so cutting 2 cm off really
      // does re-cost: costing rounds a width UP to the next 0.1 m, and an
      // allowance inside one tenth leaves COGS where it was.
      {
        roomIndex: 0,
        widthCm: 302,
        dayPrice: SIGNATURE,
        nightPrice: SIGNATURE,
        addons: [
          {
            label: "S-Fold",
            costRmbCents: 1100,
            saleSgdCents: 8000,
            basis: "per_metre" as const,
          },
          {
            label: "Slim tracks",
            costRmbCents: 3500,
            saleSgdCents: 5000,
            basis: "per_metre" as const,
          },
        ],
      },
      {
        roomIndex: 0,
        widthCm: 242,
        blindPrice: BLIND,
        addons: [],
      },
    ];
    // Quoted (and locked) before the set was confirmed…
    const quoted = computeQuote(windows, ASSUMPTIONS, "air", 0, 1000);
    // …then confirmed: curtains cut 2 cm narrower than the opening.
    const confirmed = computeQuote(
      windows.map((w) => ({ ...w, costWidthCm: (w.widthCm as number) - 2 })),
      ASSUMPTIONS,
      "air",
      0,
      1000,
    );

    // The re-cost really did happen — without this the test could pass vacuously.
    expect(confirmed.cogsRmbCents).toBeLessThan(quoted.cogsRmbCents);
    // And the customer's price did not move, so the banner stays quiet.
    expect(
      quoteStaleness(
        quoted.discountedSaleSgdCents,
        confirmed.discountedSaleSgdCents,
      ).isStale,
    ).toBe(false);
  });

  it("leaves a mesh order's price where it was quoted, floor case included", () => {
    const panels = [
      { categoryId: CAT, colourId: "col-bronze", widthCm: 200, heightCm: 150, draw: "Double" as const },
      // Over the 1 m² floor as measured, under it once cut.
      { categoryId: CAT, colourId: null, widthCm: 105, heightCm: 100, draw: "Single Left" as const },
    ];
    const quoted = computeMeshQuote(panels, MESH_BOOK, ASSUMPTIONS, "air", 0, 1500);
    const confirmed = computeMeshQuote(
      panels.map((p) => ({
        ...p,
        costWidthCm: p.widthCm - 2,
        costHeightCm: p.heightCm - 4,
      })),
      MESH_BOOK,
      ASSUMPTIONS,
      "air",
      0,
      1500,
    );

    expect(confirmed.cogsRmbCents).toBeLessThan(quoted.cogsRmbCents);
    expect(
      quoteStaleness(
        quoted.discountedSaleSgdCents,
        confirmed.discountedSaleSgdCents,
      ).isStale,
    ).toBe(false);
  });
});
