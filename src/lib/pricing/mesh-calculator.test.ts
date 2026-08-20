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
  airFreightCapRmbCents: 140000,
  trackCostRmbCentsPerM: 2500, // ¥1400
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

// The mesh half of the same breakdown: panels grouped under their room, named
// by category, still summing to COGS.
describe("computeMeshQuote — cost breakdown by room", () => {
  const inRoom = (roomIndex: number, roomLabel: string, over = {}) =>
    panel({
      roomIndex,
      roomLabel,
      itemDetail: "AirGuard",
      ...over,
    });

  it("groups panels under their room and names the category", () => {
    const q = computeMeshQuote(
      [
        inRoom(0, "Balcony"),
        inRoom(0, "Balcony", { draw: "Double" }),
        inRoom(1, "Kitchen"),
      ],
      BOOK,
      ASSUMPTIONS,
    );
    expect(q.cogsRooms.map((r) => r.label)).toEqual(["Balcony", "Kitchen"]);
    expect(q.cogsRooms[0].items.map((i) => i.label)).toEqual([
      "Panel 1",
      "Panel 2",
    ]);
    expect(q.cogsRooms[0].items[0].detail).toBe("AirGuard");
  });

  it("room subtotals sum to COGS", () => {
    const q = computeMeshQuote(
      [inRoom(0, "Balcony"), inRoom(1, "Kitchen", { colourId: BRONZE })],
      BOOK,
      ASSUMPTIONS,
    );
    expect(q.cogsRooms.reduce((n, r) => n + r.rmbCents, 0)).toBe(q.cogsRmbCents);
  });

  it("a panel's row carries its surcharges, not just the mesh", () => {
    const q = computeMeshQuote(
      [inRoom(0, "Balcony", { colourId: BRONZE, draw: "Double" })],
      BOOK,
      ASSUMPTIONS,
    );
    // area cost + Bronze 2000 + System 55 double-draw 4000.
    expect(q.cogsRooms[0].items[0].rmbCents).toBe(COST_15000 + 2000 + 4000);
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

// ── Manufacturing dimensions (Phase 13B) ─────────────────────────────────
//
// A confirmed manufacturing set cuts the mesh smaller than the opening. COGS
// follows what is cut; the sale stays on what was measured and quoted.

describe("panelQuote — manufacturing dimensions", () => {
  it("costs less and sells the same", () => {
    const made = panelQuote(
      panel({ costWidthCm: 98, costHeightCm: 146 }), // 14 308 cm² cut
      BOOK,
    );
    expect(made).toEqual({
      costRmbCents: scaleByArea(14_308, 400),
      saleSgdCents: SALE_15000,
    });
    expect(made.costRmbCents).toBeLessThan(COST_15000);
  });

  it("is byte-identical to today when the manufacturing dimensions are absent", () => {
    expect(panelQuote(panel(), BOOK)).toEqual({
      costRmbCents: COST_15000,
      saleSgdCents: SALE_15000,
    });
    expect(
      panelQuote(panel({ costWidthCm: null, costHeightCm: null }), BOOK),
    ).toEqual({ costRmbCents: COST_15000, saleSgdCents: SALE_15000 });
  });

  it("honours the minimum-area floor independently on each side", () => {
    // 105 × 100 = 1.05 m², over AirGuard's 1 m² floor. Cut down to 95 × 96 it
    // is 0.912 m² and falls under — so the COST side floors and the SALE side,
    // which the customer agreed, does not.
    const p = panel({
      widthCm: 105,
      heightCm: 100,
      costWidthCm: 95,
      costHeightCm: 96,
    });
    expect(panelQuote(p, BOOK)).toEqual({
      costRmbCents: scaleByArea(10_000, 400),
      saleSgdCents: scaleByArea(10_500, 800),
    });
  });

  it("leaves the colour and double-draw surcharges flat — they are per panel", () => {
    const over = { colourId: BRONZE, draw: "Double" as const };
    const plain = panelQuote(panel(over), BOOK);
    const made = panelQuote(
      panel({ ...over, costWidthCm: 98, costHeightCm: 146 }),
      BOOK,
    );
    // Only the area-scaled part moves; both surcharges are unchanged.
    expect(plain).toEqual({
      costRmbCents: COST_15000 + 2000 + 4000,
      saleSgdCents: SALE_15000 + 3500 + 6000,
    });
    expect(made).toEqual({
      costRmbCents: scaleByArea(14_308, 400) + 2000 + 4000,
      saleSgdCents: SALE_15000 + 3500 + 6000,
    });
  });

  it("resolves the system band from the MEASURED width, not the manufacturing one", () => {
    // The band picks a physical track system for the OPENING — a survey
    // decision about the window, not a property of the fabric being cut.
    const banded: MeshPriceBook = {
      ...BOOK,
      bands: [
        { maxWidthCm: 200, singleSystem: "System 55", doubleSystem: "System 55" },
        { maxWidthCm: 760, singleSystem: "System 68", doubleSystem: "System 55" },
      ],
      minimumAreas: {
        ...BOOK.minimumAreas,
        // A floor big enough that resolving to System 55 would be unmissable.
        [minimumKey(AIR, "System 55")]: 60_000,
      },
    };
    // Measured 201 cm is over the 200 cm boundary → System 68 (1 m² floor).
    // Cut to 199 cm it would fall into System 55 (6 m² floor).
    const p = panel({
      widthCm: 201,
      heightCm: 150,
      costWidthCm: 199,
      costHeightCm: 146,
    });
    expect(panelQuote(p, banded)).toEqual({
      costRmbCents: scaleByArea(199 * 146, 400), // unfloored: still System 68
      saleSgdCents: scaleByArea(201 * 150, 800),
    });
  });

  it("falls back to the measured dimension on the axis that has none", () => {
    // manufacture_measurements always carries both, but a half-populated panel
    // must never zero a dimension — that would zero COGS and report a ~100%
    // margin, a far more dangerous wrong answer than a slightly generous one.
    expect(panelQuote(panel({ costWidthCm: 98 }), BOOK).costRmbCents).toBe(
      scaleByArea(98 * 150, 400),
    );
    expect(
      panelQuote(panel({ costWidthCm: 0, costHeightCm: -4 }), BOOK),
    ).toEqual(panelQuote(panel(), BOOK));
  });

  it("stays free on an unmeasured panel even with manufacturing dimensions", () => {
    expect(
      panelQuote(panel({ widthCm: null, costWidthCm: 98, costHeightCm: 146 }), BOOK),
    ).toEqual({ costRmbCents: 0, saleSgdCents: 0 });
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
