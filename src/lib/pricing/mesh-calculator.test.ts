import { describe, expect, it } from "vitest";

import {
  computeMeshQuote,
  isMeasured,
  isPriced,
  meshInstallUnits,
  meshQuoteWarnings,
  panelQuote,
  priceKey,
  resolveBand,
  type MeshCalcAssumptions,
  type MeshPanel,
  type MeshPriceBook,
} from "./mesh-calculator";

const ASSUMPTIONS: MeshCalcAssumptions = {
  fxSgdToRmb: 53000, // 5.3
  gstBps: 900, // 9%
  otherCostBps: 1000, // 10%
  groupbuyDiscountBps: 1500, // 15%
  styleMultiplier: 20000, // 2.0 — unused by mesh
  handymanSingleSgdCents: 6000,
  handymanDoubleSgdCents: 10000,
  handymanBlindsSgdCents: 8000,
  handymanMeshSgdCents: 4500, // S$45 per installed panel
  seaFreightRmbCentsPerM3: 40000,
  airFreightRateBps: 6000, // 60%
  airFreightFloorRmbCents: 50000, // ¥500
  airFreightCapRmbCents: 140000, // ¥1400
};

const SMALL = "band-small"; // ≤ 2 m²
const LARGE = "band-large"; // ≤ 4 m²
const OPEN = "band-open"; // open-ended
const AIR = "cat-airguard";
const MAX = "cat-maxguard";
const WHITE = "col-white";
const BRONZE = "col-bronze";

const BOOK: MeshPriceBook = {
  // Deliberately out of order — the lookup must sort by area, not by input
  // order or by any position column.
  bands: [
    { id: OPEN, maxAreaCm2: null },
    { id: LARGE, maxAreaCm2: 40000 }, // 4 m²
    { id: SMALL, maxAreaCm2: 20000 }, // 2 m²
  ],
  prices: {
    [priceKey(AIR, SMALL)]: { costRmbCents: 12000, saleSgdCents: 18000 },
    [priceKey(AIR, LARGE)]: { costRmbCents: 20000, saleSgdCents: 30000 },
    [priceKey(AIR, OPEN)]: { costRmbCents: 30000, saleSgdCents: 45000 },
    [priceKey(MAX, SMALL)]: { costRmbCents: 25000, saleSgdCents: 40000 },
    // MaxGuard large: the admin created the cell but hasn't filled it in.
    [priceKey(MAX, LARGE)]: { costRmbCents: null, saleSgdCents: null },
    // MaxGuard open: sale entered, cost still blank — margin unreliable.
    [priceKey(MAX, OPEN)]: { costRmbCents: null, saleSgdCents: 60000 },
  },
  colours: {
    [WHITE]: { costRmbCents: null, saleSgdCents: null },
    [BRONZE]: { costRmbCents: 2000, saleSgdCents: 3500 },
  },
};

// A copy of BOOK with one cell's cost filled in, for comparing a costed panel
// against the same panel priced from a half-filled cell.
const withCost = (
  categoryId: string,
  bandId: string,
  costRmbCents: number,
): MeshPriceBook => ({
  ...BOOK,
  prices: {
    ...BOOK.prices,
    [priceKey(categoryId, bandId)]: {
      ...BOOK.prices[priceKey(categoryId, bandId)],
      costRmbCents,
    },
  },
});

const panel = (over: Partial<MeshPanel> = {}): MeshPanel => ({
  categoryId: AIR,
  colourId: WHITE,
  widthCm: 100,
  heightCm: 150, // 15000 cm² = 1.5 m² → SMALL
  ...over,
});

describe("resolveBand", () => {
  it("picks the smallest band that fits, regardless of input order", () => {
    expect(resolveBand(15000, BOOK.bands)?.id).toBe(SMALL);
    expect(resolveBand(30000, BOOK.bands)?.id).toBe(LARGE);
    expect(resolveBand(90000, BOOK.bands)?.id).toBe(OPEN);
  });

  it("treats a threshold as inclusive — exactly 2 m² is still the small band", () => {
    expect(resolveBand(20000, BOOK.bands)?.id).toBe(SMALL);
    expect(resolveBand(20001, BOOK.bands)?.id).toBe(LARGE);
  });

  it("returns null when every band is bounded and the area exceeds them all", () => {
    const bounded = BOOK.bands.filter((b) => b.maxAreaCm2 != null);
    expect(resolveBand(90000, bounded)).toBeNull();
  });
});

describe("isMeasured / isPriced", () => {
  it("isMeasured needs a category and both positive dimensions", () => {
    expect(isMeasured(panel())).toBe(true);
    expect(isMeasured(panel({ categoryId: null }))).toBe(false);
    expect(isMeasured(panel({ widthCm: null }))).toBe(false);
    expect(isMeasured(panel({ heightCm: 0 }))).toBe(false);
  });

  it("isPriced is FALSE when the cell exists but the sale is null", () => {
    // MaxGuard @ LARGE has a row with both money columns null.
    const p = panel({ categoryId: MAX, widthCm: 200, heightCm: 150 }); // 3 m²
    expect(isMeasured(p)).toBe(true);
    expect(isPriced(p, BOOK)).toBe(false);
  });

  it("isPriced is TRUE when only the cost is null", () => {
    // MaxGuard @ OPEN has a sale but no cost — the customer price is real.
    const p = panel({ categoryId: MAX, widthCm: 300, heightCm: 200 }); // 6 m²
    expect(isPriced(p, BOOK)).toBe(true);
  });
});

describe("meshInstallUnits", () => {
  it("a blank panel row adds no install cost", () => {
    const panels = [
      panel(),
      { categoryId: null, colourId: null, widthCm: null, heightCm: null },
    ];
    expect(meshInstallUnits(panels)).toBe(1);
  });

  it("a measured but unpriced panel DOES count as an install unit", () => {
    // The handyman fits it whether or not the price cell is filled in.
    const unpriced = panel({ categoryId: MAX, widthCm: 200, heightCm: 150 });
    expect(isPriced(unpriced, BOOK)).toBe(false);
    expect(meshInstallUnits([unpriced])).toBe(1);
  });
});

describe("panelQuote", () => {
  it("is flat for the band — a bigger panel in the same band costs the same", () => {
    const a = panelQuote(panel({ widthCm: 100, heightCm: 150 }), BOOK);
    const b = panelQuote(panel({ widthCm: 130, heightCm: 150 }), BOOK);
    expect(a).toEqual({ costRmbCents: 12000, saleSgdCents: 18000 });
    expect(b).toEqual(a);
  });

  it("steps up at the band boundary", () => {
    const small = panelQuote(panel({ widthCm: 100, heightCm: 200 }), BOOK); // 2 m²
    const large = panelQuote(panel({ widthCm: 101, heightCm: 200 }), BOOK); // >2 m²
    expect(small.saleSgdCents).toBe(18000);
    expect(large.saleSgdCents).toBe(30000);
  });

  it("adds the colour surcharge flat, not scaled by area", () => {
    const q = panelQuote(panel({ colourId: BRONZE }), BOOK);
    expect(q).toEqual({
      costRmbCents: 12000 + 2000,
      saleSgdCents: 18000 + 3500,
    });
  });

  it("is zero for an unmeasured panel", () => {
    expect(panelQuote(panel({ widthCm: null }), BOOK)).toEqual({
      costRmbCents: 0,
      saleSgdCents: 0,
    });
  });

  it("treats a null cost as zero COGS but keeps the real sale", () => {
    const q = panelQuote(
      panel({ categoryId: MAX, widthCm: 300, heightCm: 200 }),
      BOOK,
    );
    expect(q).toEqual({ costRmbCents: 0, saleSgdCents: 60000 });
  });
});

describe("computeMeshQuote", () => {
  it("charges install per measured panel and bills freight on full panel COGS", () => {
    const panels = [panel(), panel()];
    const q = computeMeshQuote(panels, BOOK, ASSUMPTIONS);

    expect(q.cogsRmbCents).toBe(24000); // 2 × ¥120
    expect(q.saleSgdCents).toBe(36000); // 2 × S$180
    // Freight base is the full COGS: 60% of ¥240 = ¥144, below the ¥500 floor.
    expect(q.freightRmbCents).toBe(ASSUMPTIONS.airFreightFloorRmbCents);
    expect(q.installationSgdCents).toBe(2 * 4500);
  });

  it("does not charge install for a blank row added to the form", () => {
    const withBlank = computeMeshQuote(
      [panel(), { categoryId: null, colourId: null, widthCm: null, heightCm: null }],
      BOOK,
      ASSUMPTIONS,
    );
    const without = computeMeshQuote([panel()], BOOK, ASSUMPTIONS);
    expect(withBlank.installationSgdCents).toBe(without.installationSgdCents);
    expect(withBlank.netCostSgdCents).toBe(without.netCostSgdCents);
  });

  it("applies the order-level discount to the sale", () => {
    const q = computeMeshQuote([panel()], BOOK, ASSUMPTIONS, "air", 0, 1500);
    expect(q.saleSgdCents).toBe(18000);
    expect(q.discountedSaleSgdCents).toBe(15300); // −15%
  });

  it("uses the flat sea charge when shipping by sea", () => {
    const q = computeMeshQuote([panel()], BOOK, ASSUMPTIONS, "sea");
    expect(q.freightRmbCents).toBe(ASSUMPTIONS.seaFreightRmbCentsPerM3);
  });

  it("adds the ad-hoc extra install on top", () => {
    const q = computeMeshQuote([panel()], BOOK, ASSUMPTIONS, "air", 2500);
    expect(q.installationSgdCents).toBe(4500 + 2500);
  });

  it("overstates margin when the cost cell is blank, above any floor", () => {
    // The failure meshQuoteWarnings.missingCostPanels exists to surface: a
    // blank cost yields zero COGS, so the margin reads far too high — and
    // crucially it sits ABOVE the margin floor, so the below-floor guard in
    // the live quote can never catch it.
    const p = panel({ categoryId: MAX, widthCm: 300, heightCm: 200 });
    const blankCost = computeMeshQuote([p], BOOK, ASSUMPTIONS);

    const costed = computeMeshQuote([p], withCost(MAX, OPEN, 30000), ASSUMPTIONS);

    expect(blankCost.cogsRmbCents).toBe(0);
    expect(blankCost.marginBps).toBeGreaterThan(costed.marginBps);
    // Standard floor is 35%; this reads ~77% and would never trip the guard.
    expect(blankCost.marginBps).toBeGreaterThan(3500);
    expect(meshQuoteWarnings([p], BOOK).missingCostPanels).toEqual([0]);
  });
});

describe("meshQuoteWarnings", () => {
  it("is silent for a fully priced panel", () => {
    expect(meshQuoteWarnings([panel()], BOOK)).toEqual({
      unpricedPanels: [],
      reasons: [],
      missingCostPanels: [],
    });
  });

  it("ignores an untouched blank row", () => {
    const blank = {
      categoryId: null,
      colourId: null,
      widthCm: null,
      heightCm: null,
    };
    expect(meshQuoteWarnings([blank], BOOK).unpricedPanels).toEqual([]);
  });

  it("flags a started row with no category", () => {
    const w = meshQuoteWarnings([panel({ categoryId: null })], BOOK);
    expect(w.unpricedPanels).toEqual([0]);
    expect(w.reasons).toEqual(["no-category"]);
  });

  it("flags a category with no dimensions", () => {
    const w = meshQuoteWarnings(
      [panel({ widthCm: null, heightCm: null, colourId: BRONZE })],
      BOOK,
    );
    expect(w.reasons).toEqual(["no-dimensions"]);
  });

  it("flags an area that exceeds every bounded band", () => {
    const bounded: MeshPriceBook = {
      ...BOOK,
      bands: BOOK.bands.filter((b) => b.maxAreaCm2 != null),
    };
    const w = meshQuoteWarnings(
      [panel({ widthCm: 300, heightCm: 300 })],
      bounded,
    );
    expect(w.reasons).toEqual(["no-band"]);
  });

  it("distinguishes a missing cell from an empty one", () => {
    // MaxGuard has no OPEN-band gap, so remove one to get a true miss.
    const gapped: MeshPriceBook = {
      ...BOOK,
      prices: Object.fromEntries(
        Object.entries(BOOK.prices).filter(
          ([k]) => k !== priceKey(MAX, SMALL),
        ),
      ),
    };
    const missing = meshQuoteWarnings([panel({ categoryId: MAX })], gapped);
    expect(missing.reasons).toEqual(["no-price-row"]);

    const empty = meshQuoteWarnings(
      [panel({ categoryId: MAX, widthCm: 200, heightCm: 150 })],
      BOOK,
    );
    expect(empty.reasons).toEqual(["price-row-empty"]);
  });

  it("puts a null cost in missingCostPanels, NOT in unpricedPanels", () => {
    const w = meshQuoteWarnings(
      [panel({ categoryId: MAX, widthCm: 300, heightCm: 200 })],
      BOOK,
    );
    expect(w.unpricedPanels).toEqual([]);
    expect(w.missingCostPanels).toEqual([0]);
    expect(w.reasons).toEqual([]);
  });

  it("dedupes reasons across panels and reports every index", () => {
    const w = meshQuoteWarnings(
      [panel({ categoryId: null }), panel({ categoryId: null }), panel()],
      BOOK,
    );
    expect(w.unpricedPanels).toEqual([0, 1]);
    expect(w.reasons).toEqual(["no-category"]);
  });
});
