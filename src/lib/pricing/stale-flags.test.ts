import { describe, expect, it } from "vitest";

import type { CalcAddonBook, CalcWindow } from "./calculator";
import {
  type MeshCalcAssumptions,
  type MeshPanel,
  type MeshPriceBook,
} from "./mesh-calculator";
import { computeStaleFlags, type StaleOrderRow } from "./stale-flags";

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

const BOOK: CalcAddonBook = {
  sFold: { costRmbCents: 1100, saleSgdCents: 8000, basis: "per_metre" },
  slimTracks: { costRmbCents: 3500, saleSgdCents: 5000, basis: "per_metre" },
};

const CAT = "cat-airguard";

const MESH_BOOK: MeshPriceBook = {
  rates: {
    [CAT]: { costRmbCentsPerSqft: 400, saleSgdCentsPerSqft: 800 },
  },
  colours: {},
  bands: [
    { maxWidthCm: 760, singleSystem: "System 68", doubleSystem: "System 55" },
  ],
  doubleSurcharges: {},
  minimumAreas: {},
};

const MESH_PANEL: MeshPanel = {
  categoryId: CAT,
  colourId: null,
  widthCm: 100,
  heightCm: 150,
  draw: "Single Left",
};

const CURTAIN_WINDOW: CalcWindow = {
  widthCm: 280,
  dayPrice: { costRmbCents: 5100, saleSgdCents: 9000 },
  nightPrice: null,
  addSFold: false,
  addSlimTracks: false,
};

const order = (over: Partial<StaleOrderRow> = {}): StaleOrderRow => ({
  id: "order-1",
  product_line: "curtain",
  freight_mode: "air",
  extra_install_sgd_cents: 0,
  discount_bps: 0,
  price_calc_at_quote_cents: null,
  ...over,
});

const run = (
  orders: StaleOrderRow[],
  windowsByOrder = new Map<string, CalcWindow[]>(),
  panelsByOrder = new Map<string, MeshPanel[]>(),
) =>
  computeStaleFlags({
    orders,
    windowsByOrder,
    panelsByOrder,
    book: BOOK,
    meshBook: MESH_BOOK,
    assumptions: ASSUMPTIONS,
  });

describe("computeStaleFlags — mesh routing", () => {
  it("does NOT flag a quoted mesh order whose baseline still matches", () => {
    // The regression this test exists for: routing a mesh order through the
    // curtain engine finds zero `windows` rows, quotes $0, compares that to a
    // non-null baseline, and flags a re-quote banner that can never clear.
    const panels = new Map([["order-1", [MESH_PANEL]]]);
    // One 100 × 150 cm panel: 16.14587 ft² × S$8.00/ft², no discount.
    const baseline = 12917;

    const flags = run(
      [
        order({
          product_line: "mesh",
          price_calc_at_quote_cents: baseline,
        }),
      ],
      new Map(),
      panels,
    );

    expect(flags.get("order-1")).toBe(false);
  });

  it("still flags a mesh order when the calculation has genuinely drifted", () => {
    const panels = new Map([["order-1", [MESH_PANEL]]]);
    const flags = run(
      [order({ product_line: "mesh", price_calc_at_quote_cents: 12000 })],
      new Map(),
      panels,
    );
    expect(flags.get("order-1")).toBe(true);
  });

  it("applies the order discount before comparing to the baseline", () => {
    const panels = new Map([["order-1", [MESH_PANEL]]]);
    const flags = run(
      [
        order({
          product_line: "mesh",
          discount_bps: 1500,
          price_calc_at_quote_cents: 10979, // 12917 − 15%
        }),
      ],
      new Map(),
      panels,
    );
    expect(flags.get("order-1")).toBe(false);
  });

  it("never flags an order with no baseline captured, either product line", () => {
    const flags = run([
      order({ id: "c", price_calc_at_quote_cents: null }),
      order({ id: "m", product_line: "mesh", price_calc_at_quote_cents: null }),
    ]);
    expect(flags.get("c")).toBe(false);
    expect(flags.get("m")).toBe(false);
  });
});

describe("computeStaleFlags — curtain behaviour is unchanged", () => {
  it("does not flag a curtain order whose baseline matches", () => {
    const windows = new Map([["order-1", [CURTAIN_WINDOW]]]);
    // 2.8 m × S$90/m = S$252.00
    const flags = run(
      [order({ price_calc_at_quote_cents: 25200 })],
      windows,
      new Map(),
    );
    expect(flags.get("order-1")).toBe(false);
  });

  it("flags a curtain order whose baseline has drifted", () => {
    const windows = new Map([["order-1", [CURTAIN_WINDOW]]]);
    const flags = run(
      [order({ price_calc_at_quote_cents: 24000 })],
      windows,
      new Map(),
    );
    expect(flags.get("order-1")).toBe(true);
  });

  it("routes a mixed batch to the right engine per order", () => {
    const windows = new Map([["c", [CURTAIN_WINDOW]]]);
    const panels = new Map([["m", [MESH_PANEL]]]);
    const flags = run(
      [
        order({ id: "c", price_calc_at_quote_cents: 25200 }),
        order({
          id: "m",
          product_line: "mesh",
          price_calc_at_quote_cents: 12917,
        }),
      ],
      windows,
      panels,
    );
    expect(flags.get("c")).toBe(false);
    expect(flags.get("m")).toBe(false);
  });
});
