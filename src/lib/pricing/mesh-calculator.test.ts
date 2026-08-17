import { describe, expect, it } from "vitest";

import {
  computeMeshQuote,
  isMeasured,
  isPriced,
  meshInstallUnits,
  meshQuoteWarnings,
  minimumKey,
  panelBillableArea,
  panelQuote,
  scaleByArea,
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

const AIR = "cat-airguard";
const MAX = "cat-maxguard";
const UNPRICED = "cat-unpriced";
const WHITE = "col-white";
const BRONZE = "col-bronze";

const BOOK: MeshPriceBook = {
  rates: {
    [AIR]: { costRmbCentsPerSqft: 400, saleSgdCentsPerSqft: 800 },
    // MaxGuard: sale entered, cost still blank — margin unreliable.
    [MAX]: { costRmbCentsPerSqft: null, saleSgdCentsPerSqft: 1100 },
    // Created but never priced.
    [UNPRICED]: { costRmbCentsPerSqft: null, saleSgdCentsPerSqft: null },
  },
  colours: {
    [WHITE]: { costRmbCents: null, saleSgdCents: null },
    [BRONZE]: { costRmbCents: 2000, saleSgdCents: 3500 },
  },
  // A single open band so every width resolves; the surcharge is what these
  // tests care about, not which system gets picked.
  bands: [
    { maxWidthCm: 760, singleSystem: "System 68", doubleSystem: "System 55" },
  ],
  doubleSurcharges: {
    "system 55": { costRmbCents: 4000, saleSgdCents: 6000 },
    "system 68": { costRmbCents: 5000, saleSgdCents: 7500 },
  },
  // AirGuard floors at 1 m² per leaf on System 68 (the band every width in
  // these tests resolves to for a single draw); MaxGuard at 2 m² on System 55.
  minimumAreas: {
    [minimumKey(AIR, "System 68")]: 10_000,
    [minimumKey(MAX, "System 55")]: 20_000,
  },
};

// A copy of BOOK with one category's cost rate filled in, for comparing a
// costed panel against the same panel priced from a half-filled category.
const withCost = (
  categoryId: string,
  costRmbCentsPerSqft: number,
): MeshPriceBook => ({
  ...BOOK,
  rates: {
    ...BOOK.rates,
    [categoryId]: { ...BOOK.rates[categoryId], costRmbCentsPerSqft },
  },
});

const panel = (over: Partial<MeshPanel> = {}): MeshPanel => ({
  categoryId: AIR,
  colourId: WHITE,
  widthCm: 100,
  heightCm: 150, // 15000 cm² = 16.1459 ft²
  draw: "Single Left",
  ...over,
});

const BLANK: MeshPanel = {
  categoryId: null,
  colourId: null,
  widthCm: null,
  heightCm: null,
  draw: null,
};

// 15000 cm² at S$8.00/ft² → 16.14587 × 800 = 12916.69 → 12917.
const SALE_15000 = 12917;
// …and at ¥4.00/ft² → 6458.35 → 6458. Rounded independently of the sale, which
// is why this is not exactly half of SALE_15000.
const COST_15000 = 6458;

describe("scaleByArea", () => {
  it("converts cm² to ft² and rounds to the nearest cent", () => {
    // 1 m² is 10.76391 ft²; at S$10.00/ft² that is S$107.64.
    expect(scaleByArea(10_000, 1000)).toBe(10_764);
  });

  it("prices the default panel from its true area, not a band", () => {
    expect(scaleByArea(15_000, 800)).toBe(SALE_15000);
    expect(scaleByArea(15_000, 400)).toBe(COST_15000);
  });

  it("is zero for a zero rate", () => {
    expect(scaleByArea(15_000, 0)).toBe(0);
  });
});

describe("isMeasured / isPriced", () => {
  it("isMeasured needs a category and both positive dimensions", () => {
    expect(isMeasured(panel())).toBe(true);
    expect(isMeasured(panel({ categoryId: null }))).toBe(false);
    expect(isMeasured(panel({ widthCm: null }))).toBe(false);
    expect(isMeasured(panel({ heightCm: 0 }))).toBe(false);
  });

  it("isPriced is FALSE when the category has no sale rate", () => {
    const p = panel({ categoryId: UNPRICED });
    expect(isMeasured(p)).toBe(true);
    expect(isPriced(p, BOOK)).toBe(false);
  });

  it("isPriced is TRUE when only the cost rate is null", () => {
    // MaxGuard has a sale rate but no cost — the customer price is real.
    expect(isPriced(panel({ categoryId: MAX }), BOOK)).toBe(true);
  });

  it("isPriced is FALSE for a category absent from the book", () => {
    expect(isPriced(panel({ categoryId: "cat-unknown" }), BOOK)).toBe(false);
  });
});

describe("meshInstallUnits", () => {
  it("a blank panel row adds no install cost", () => {
    const panels = [
      panel(),
      BLANK,
    ];
    expect(meshInstallUnits(panels)).toBe(1);
  });

  it("a measured but unpriced panel DOES count as an install unit", () => {
    // The handyman fits it whether or not the category has been priced.
    const unpriced = panel({ categoryId: UNPRICED });
    expect(isPriced(unpriced, BOOK)).toBe(false);
    expect(meshInstallUnits([unpriced])).toBe(1);
  });
});

describe("panelQuote", () => {
  it("scales with area — a bigger panel costs more", () => {
    const small = panelQuote(panel({ widthCm: 100, heightCm: 150 }), BOOK);
    const big = panelQuote(panel({ widthCm: 200, heightCm: 150 }), BOOK);

    expect(small).toEqual({
      costRmbCents: COST_15000,
      saleSgdCents: SALE_15000,
    });
    // Twice the area, but rounded once per panel — 25833, not 2 × 12917.
    expect(big.saleSgdCents).toBe(25_833);
  });

  it("has no band step — one cm² more is one increment more", () => {
    const a = panelQuote(panel({ widthCm: 100, heightCm: 200 }), BOOK);
    const b = panelQuote(panel({ widthCm: 101, heightCm: 200 }), BOOK);
    expect(b.saleSgdCents).toBeGreaterThan(a.saleSgdCents);
    expect(b.saleSgdCents - a.saleSgdCents).toBeLessThan(200);
  });

  it("adds the colour surcharge flat, not scaled by area", () => {
    const small = panelQuote(panel({ colourId: BRONZE }), BOOK);
    const big = panelQuote(
      panel({ colourId: BRONZE, widthCm: 200, heightCm: 150 }),
      BOOK,
    );

    expect(small).toEqual({
      costRmbCents: COST_15000 + 2000,
      saleSgdCents: SALE_15000 + 3500,
    });
    // The same flat surcharge on a panel of twice the area.
    expect(big.saleSgdCents).toBe(25_833 + 3500);
  });

  it("adds the system's double-draw surcharge, flat, on a double only", () => {
    // 100 × 150 resolves to System 55 on a double: +¥40 / +S$60 per panel.
    const single = panelQuote(panel({ draw: "Single Left" }), BOOK);
    const double = panelQuote(panel({ draw: "Double" }), BOOK);

    expect(single).toEqual({
      costRmbCents: COST_15000,
      saleSgdCents: SALE_15000,
    });
    expect(double).toEqual({
      costRmbCents: COST_15000 + 4000,
      saleSgdCents: SALE_15000 + 6000,
    });
  });

  it("does not scale the double surcharge by area", () => {
    const small = panelQuote(panel({ draw: "Double" }), BOOK);
    const big = panelQuote(
      panel({ draw: "Double", widthCm: 200, heightCm: 150 }),
      BOOK,
    );
    // Twice the area, identical surcharge — 25833 is the doubled base.
    expect(big.saleSgdCents - 25_833).toBe(small.saleSgdCents - SALE_15000);
  });

  it("charges nothing when the system has no surcharge configured", () => {
    const bare: MeshPriceBook = { ...BOOK, doubleSurcharges: {} };
    expect(panelQuote(panel({ draw: "Double" }), bare)).toEqual({
      costRmbCents: COST_15000,
      saleSgdCents: SALE_15000,
    });
  });

  it("charges nothing when no system resolves for the width", () => {
    // 900 cm is past every band, so there is no system to charge for.
    const q = panelQuote(
      panel({ draw: "Double", widthCm: 900, heightCm: 150 }),
      BOOK,
    );
    expect(q.saleSgdCents).toBe(scaleByArea(900 * 150, 800));
  });

  it("stacks the colour and double surcharges", () => {
    const q = panelQuote(panel({ draw: "Double", colourId: BRONZE }), BOOK);
    expect(q).toEqual({
      costRmbCents: COST_15000 + 2000 + 4000,
      saleSgdCents: SALE_15000 + 3500 + 6000,
    });
  });

  it("is zero for an unmeasured panel", () => {
    expect(panelQuote(panel({ widthCm: null }), BOOK)).toEqual({
      costRmbCents: 0,
      saleSgdCents: 0,
    });
  });

  it("is zero for a category with no rates at all", () => {
    expect(panelQuote(panel({ categoryId: UNPRICED }), BOOK)).toEqual({
      costRmbCents: 0,
      saleSgdCents: 0,
    });
  });

  it("treats a null cost rate as zero COGS but keeps the real sale", () => {
    const q = panelQuote(panel({ categoryId: MAX }), BOOK);
    // 16.14587 ft² × S$11.00 = 17760.45 → 17760.
    expect(q).toEqual({ costRmbCents: 0, saleSgdCents: 17_760 });
  });
});

describe("computeMeshQuote", () => {
  it("charges install per measured panel and bills freight on full panel COGS", () => {
    const q = computeMeshQuote([panel(), panel()], BOOK, ASSUMPTIONS);

    expect(q.cogsRmbCents).toBe(2 * COST_15000);
    expect(q.saleSgdCents).toBe(2 * SALE_15000);
    // Freight base is the full COGS: 60% of ¥129.16 is below the ¥500 floor.
    expect(q.freightRmbCents).toBe(ASSUMPTIONS.airFreightFloorRmbCents);
    expect(q.installationSgdCents).toBe(2 * 4500);
  });

  it("does not charge install for a blank row added to the form", () => {
    const withBlank = computeMeshQuote(
      [panel(), BLANK],
      BOOK,
      ASSUMPTIONS,
    );
    const without = computeMeshQuote([panel()], BOOK, ASSUMPTIONS);
    expect(withBlank.installationSgdCents).toBe(without.installationSgdCents);
    expect(withBlank.netCostSgdCents).toBe(without.netCostSgdCents);
  });

  it("applies the order-level discount to the sale", () => {
    const q = computeMeshQuote([panel()], BOOK, ASSUMPTIONS, "air", 0, 1500);
    expect(q.saleSgdCents).toBe(SALE_15000);
    expect(q.discountedSaleSgdCents).toBe(10_979); // −15%
  });

  it("uses the flat sea charge when shipping by sea", () => {
    const q = computeMeshQuote([panel()], BOOK, ASSUMPTIONS, "sea");
    expect(q.freightRmbCents).toBe(ASSUMPTIONS.seaFreightRmbCentsPerM3);
  });

  it("adds the ad-hoc extra install on top", () => {
    const q = computeMeshQuote([panel()], BOOK, ASSUMPTIONS, "air", 2500);
    expect(q.installationSgdCents).toBe(4500 + 2500);
  });

  it("overstates margin when the cost rate is blank, above any floor", () => {
    // The failure meshQuoteWarnings.missingCostPanels exists to surface: a
    // blank cost rate yields zero COGS, so the margin reads far too high — and
    // crucially it sits ABOVE the margin floor, so the below-floor guard in
    // the live quote can never catch it.
    //
    // A whole-flat order rather than one panel: on a single small panel the
    // ¥500 air-freight floor dominates the cost side and masks the effect.
    const panels = Array.from({ length: 4 }, () =>
      panel({ categoryId: MAX, widthCm: 200, heightCm: 150 }),
    );
    const blankCost = computeMeshQuote(panels, BOOK, ASSUMPTIONS);
    const costed = computeMeshQuote(panels, withCost(MAX, 550), ASSUMPTIONS);

    expect(blankCost.cogsRmbCents).toBe(0);
    expect(blankCost.marginBps).toBeGreaterThan(costed.marginBps);
    // Standard floor is 35%; this reads far above it and would never trip.
    expect(blankCost.marginBps).toBeGreaterThan(3500);
    expect(meshQuoteWarnings(panels, BOOK).missingCostPanels).toEqual([
      0, 1, 2, 3,
    ]);
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
    expect(meshQuoteWarnings([BLANK], BOOK).unpricedPanels).toEqual([]);
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

  it("flags a category with no sale rate", () => {
    const w = meshQuoteWarnings([panel({ categoryId: UNPRICED })], BOOK);
    expect(w.unpricedPanels).toEqual([0]);
    expect(w.reasons).toEqual(["no-rate"]);
  });

  it("flags a category missing from the book entirely", () => {
    const w = meshQuoteWarnings([panel({ categoryId: "cat-unknown" })], BOOK);
    expect(w.reasons).toEqual(["no-rate"]);
  });

  it("puts a null cost rate in missingCostPanels, NOT in unpricedPanels", () => {
    const w = meshQuoteWarnings([panel({ categoryId: MAX })], BOOK);
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

describe("panelBillableArea", () => {
  it("bills the measured area when it clears the minimum", () => {
    // 100 × 150 = 1.5 m², above AirGuard's 1 m² single-draw floor.
    expect(panelBillableArea(panel(), BOOK)).toEqual({
      actualCm2: 15_000,
      minimumCm2: 10_000,
      billableCm2: 15_000,
    });
  });

  it("floors a small panel to the minimum", () => {
    const small = panel({ widthCm: 60, heightCm: 100 }); // 0.6 m²
    expect(panelBillableArea(small, BOOK)).toEqual({
      actualCm2: 6_000,
      minimumCm2: 10_000,
      billableCm2: 10_000,
    });
  });

  it("doubles the floor for a double draw — one minimum per leaf", () => {
    // The worked example: 240 cm MaxGuard double resolves to System 55, whose
    // floor is 2 m² per leaf, so the panel bills at 4 m² even though it
    // measures 2.964.
    const p = panel({
      categoryId: MAX,
      widthCm: 240,
      heightCm: 123,
      draw: "Double",
    });
    expect(panelBillableArea(p, BOOK)).toEqual({
      actualCm2: 29_520,
      minimumCm2: 40_000,
      billableCm2: 40_000,
    });
  });

  it("has no floor when the (category, system) cell is empty", () => {
    // MaxGuard has no minimum configured on System 68.
    const p = panel({ categoryId: MAX, widthCm: 200, draw: "Single Left" });
    expect(panelBillableArea(p, BOOK)).toMatchObject({
      minimumCm2: 0,
      billableCm2: 30_000, // 200 × 150, billed as measured
    });
  });

  it("has no floor when no system resolves", () => {
    const p = panel({ widthCm: 900, draw: "Single Left" });
    expect(panelBillableArea(p, BOOK)).toMatchObject({ minimumCm2: 0 });
  });

  it("is null for an unmeasured panel", () => {
    expect(panelBillableArea(panel({ widthCm: null }), BOOK)).toBeNull();
  });
});

describe("panelQuote — minimum billable area", () => {
  it("prices a floored panel on the minimum, not the measurement", () => {
    const small = panel({ widthCm: 60, heightCm: 100 }); // 0.6 m² → floored to 1
    const q = panelQuote(small, BOOK);
    expect(q.saleSgdCents).toBe(scaleByArea(10_000, 800));
  });

  it("floors COST as well as SALE, so the margin stays honest", () => {
    // Flooring the sale alone would report a margin that climbs on every
    // under-minimum panel -- flattering, and wrong.
    const small = panel({ widthCm: 60, heightCm: 100 });
    expect(panelQuote(small, BOOK)).toEqual({
      costRmbCents: scaleByArea(10_000, 400),
      saleSgdCents: scaleByArea(10_000, 800),
    });
  });

  it("charges a small panel the same as one exactly at the minimum", () => {
    const tiny = panelQuote(panel({ widthCm: 40, heightCm: 50 }), BOOK);
    const atFloor = panelQuote(panel({ widthCm: 100, heightCm: 100 }), BOOK);
    expect(tiny).toEqual(atFloor);
  });
});
