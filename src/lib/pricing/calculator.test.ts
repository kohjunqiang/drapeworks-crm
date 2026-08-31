import { describe, expect, it } from "vitest";

import {
  ceilToTenCm,
  computeQuote,
  marginBps,
  windowQuote,
  type CalcAssumptions,
} from "./calculator";

const ASSUMPTIONS: CalcAssumptions = {
  fxSgdToRmb: 53000, // 5.3
  gstBps: 900, // 9%
  otherCostBps: 1000, // 10%
  groupbuyDiscountBps: 1500, // 15%
  styleMultiplier: 20000, // 2.0
  handymanSingleSgdCents: 6000, // single curtain — S$60
  handymanDoubleSgdCents: 10000, // double curtain — S$100
  handymanBlindsSgdCents: 8000, // blinds — S$80
  seaFreightRmbCentsPerM3: 40000, // ¥400 flat
  airFreightRateBps: 6000, // 60%
  airFreightFloorRmbCents: 50000, // ¥500
  airFreightCapRmbCents: 140000, // ¥1400
  trackCostRmbCentsPerM: 2500, // ¥25 per metre of MEASURED width
};

// The two curtain add-ons, as the resolver would hand them over. Labels match
// the ones the old hard-coded legs used, so the leg assertions below still
// describe what a consultant sees.
const S_FOLD = {
  label: "S-Fold",
  costRmbCents: 1100,
  saleSgdCents: 8000,
  basis: "per_metre" as const,
};
const SLIM = {
  label: "Slim tracks",
  costRmbCents: 3500,
  saleSgdCents: 5000,
  basis: "per_metre" as const,
};

const SIGNATURE = { costRmbCents: 5100, saleSgdCents: 9000 }; // ¥51 / S$90 per m

describe("windowQuote", () => {
  it("prices a day-only 2.8m window with S-Fold + single track", () => {
    const q = windowQuote(
      {
        widthCm: 280,
        dayPrice: SIGNATURE,
        nightPrice: null,
        addons: [S_FOLD],
      },
      ASSUMPTIONS,
    );
    // day cost 2.8×2×5100=28560, sale 2.8×9000=25200
    // s-fold cost 2.8×1100=3080, sale 2.8×8000=22400
    // single rail 2.8m×¥25=7000 (into COGS); it is NOT billed to the customer.
    // sale = fabric 25200 + s-fold 22400 = 47600; curtain-only cost = day 28560
    expect(q).toEqual({
      costRmbCents: 38640,
      saleSgdCents: 47600,
      curtainCostRmbCents: 28560,
      offering: "single",
      // Reported apart so the breakdown can list the rails on their own line.
      trackRmbCents: 7000,
      trackKind: "single",
      // What the window's own figure is made of. The rail is NOT among them —
      // it is lifted out and counted with the other rails.
      legs: [
        { label: "Day curtain", detail: null, rmbCents: 28560 },
        { label: "S-Fold", detail: null, rmbCents: 3080 },
      ],
    });
  });

  it("uses a double track when both day + night are present", () => {
    const q = windowQuote(
      {
        widthCm: 300,
        dayPrice: SIGNATURE,
        nightPrice: SIGNATURE,
        addons: [],
      },
      ASSUMPTIONS,
    );
    // day+night cost 2×(3×2×5100)=61200, sale 2×(3×9000)=54000
    // A double rail is two runs over the same opening: 2×3.0m×¥25=15000 into
    // COGS. Its cost is NOT billed to the customer.
    // sale = fabric 54000 only; curtain-only cost = 61200
    expect(q).toEqual({
      costRmbCents: 76200,
      saleSgdCents: 54000,
      curtainCostRmbCents: 61200,
      offering: "double",
      trackRmbCents: 15000,
      trackKind: "double",
      legs: [
        { label: "Day curtain", detail: null, rmbCents: 30600 },
        { label: "Night curtain", detail: null, rmbCents: 30600 },
      ],
    });
  });

  it("keeps the track out of the customer quote but in COGS (it's a cost, not a customer line)", () => {
    const q = windowQuote(
      {
        widthCm: 300,
        dayPrice: SIGNATURE,
        nightPrice: SIGNATURE,
        addons: [],
      },
      ASSUMPTIONS,
    );
    // Sale is fabric only: 2×(3×9000)=54000 — no rail reaches the customer.
    expect(q.saleSgdCents).toBe(54000);
    // Its cost IS still carried: day+night 61200 + rail 15000 = 76200.
    expect(q.costRmbCents).toBe(76200);
  });

  it("a combo overrides the sale but leaves cost/COGS unchanged", () => {
    const base = {
      widthCm: 300,
      dayPrice: SIGNATURE,
      nightPrice: SIGNATURE,
      addons: [],
    };
    const plain = windowQuote(base, ASSUMPTIONS);
    const combo = windowQuote(
      { ...base, comboPriceSgdCents: 45000 }, // S$450 bundle
      ASSUMPTIONS,
    );
    // Sale is fixed to the bundle price; every cost figure is identical.
    expect(combo.saleSgdCents).toBe(45000);
    expect(combo.costRmbCents).toBe(plain.costRmbCents);
    expect(combo.curtainCostRmbCents).toBe(plain.curtainCostRmbCents);
    expect(combo.offering).toBe(plain.offering);
  });

  it("adds chargeable extras on top of a combo instead of making them free", () => {
    const q = windowQuote(
      {
        widthCm: 300,
        nightPrice: { costRmbCents: 2_000, saleSgdCents: 10_000 },
        comboPriceSgdCents: 45_000,
        addons: [
          {
            label: "Blackout",
            costRmbCents: 500,
            saleSgdCents: 5_000,
            basis: "per_metre",
          },
        ],
      },
      ASSUMPTIONS,
    );

    expect(q.saleSgdCents).toBe(60_000); // S$450 package + 3m × S$50
  });

  it("does not charge a stale combo or flat add-on on an unmeasured window", () => {
    const q = windowQuote(
      {
        widthCm: null,
        nightPrice: { costRmbCents: 2_000, saleSgdCents: 10_000 },
        comboPriceSgdCents: 45_000,
        addons: [
          {
            label: "Layer",
            costRmbCents: 500,
            saleSgdCents: 5_000,
            basis: "per_unit",
          },
        ],
      },
      ASSUMPTIONS,
    );
    expect(q.saleSgdCents).toBe(0);
    expect(q.costRmbCents).toBe(0);
  });

  it("is zero for an unmeasured / unpriced window", () => {
    expect(
      windowQuote(
        { widthCm: null, addons: [S_FOLD, SLIM] },
        ASSUMPTIONS,
      ),
    ).toEqual({
      costRmbCents: 0,
      saleSgdCents: 0,
      curtainCostRmbCents: 0,
      offering: "none",
      // No curtain, so no rail to buy.
      trackRmbCents: 0,
      trackKind: null,
      legs: [],
    });
  });
});

// The breakdown the cost panel renders: COGS room by room, window by window.
// The room subtotals must still add up to the COGS that freight, other cost and
// GST are charged on — nothing counted twice, nothing dropped.
describe("computeQuote — cost breakdown by room", () => {
  const ESSENTIAL = { ...SIGNATURE, label: "Essential" };
  const NIGHT = { ...SIGNATURE, label: "Signature" };

  const order = () =>
    computeQuote(
      [
        {
          roomIndex: 0,
          roomLabel: "Living Room",
          widthCm: 280,
          dayPrice: ESSENTIAL,
          nightPrice: NIGHT,
          addons: [S_FOLD],
        },
        {
          roomIndex: 0,
          roomLabel: "Living Room",
          widthCm: 150,
          dayPrice: ESSENTIAL,
          nightPrice: null,
          addons: [],
        },
        {
          roomIndex: 1,
          roomLabel: "Bedroom",
          widthCm: 150,
          blindPrice: { ...SIGNATURE, label: "Korean Combi" },
          addons: [],
        },
      ],
      ASSUMPTIONS,
    );

  it("groups windows under their room, in capture order", () => {
    const rooms = order().cogsRooms;
    expect(rooms.map((r) => r.label)).toEqual(["Living Room", "Bedroom"]);
    expect(rooms[0].items.map((i) => i.label)).toEqual(["Window 1", "Window 2"]);
    // Numbered within the room, not across the order.
    expect(rooms[1].items.map((i) => i.label)).toEqual(["Window 1"]);
  });

  it("names each window by the series it was quoted from", () => {
    const rooms = order().cogsRooms;
    // Day and night from different series — both named, in that order.
    expect(rooms[0].items[0].detail).toBe("Essential + Signature");
    // Day only.
    expect(rooms[0].items[1].detail).toBe("Essential");
    // A blind says so: it is priced by different rules.
    expect(rooms[1].items[0].detail).toBe("Korean Combi (blind)");
  });

  it("says a series once when day and night share it", () => {
    const q = computeQuote(
      [
        {
          roomIndex: 0,
          roomLabel: "Study",
          widthCm: 200,
          dayPrice: ESSENTIAL,
          nightPrice: { ...ESSENTIAL },
          addons: [],
        },
      ],
      ASSUMPTIONS,
    );
    expect(q.cogsRooms[0].items[0].detail).toBe("Essential");
  });

  it("leaves the detail null when the series has no name", () => {
    const q = computeQuote(
      [
        {
          widthCm: 200,
          dayPrice: SIGNATURE, // no label
          addons: [],
        },
      ],
      ASSUMPTIONS,
    );
    expect(q.cogsRooms[0].items[0].detail).toBeNull();
  });

  it("rooms plus the rails sum to COGS, and each room to its windows", () => {
    const q = order();
    const rooms = q.cogsRooms.reduce((n, r) => n + r.rmbCents, 0);
    const extras = q.cogsExtras.reduce((n, e) => n + e.rmbCents, 0);
    expect(rooms + extras).toBe(q.cogsRmbCents);
    for (const room of q.cogsRooms) {
      expect(room.items.reduce((n, i) => n + i.rmbCents, 0)).toBe(room.rmbCents);
    }
  });

  it("a window's row carries its add-ons but NOT its rail", () => {
    const q = computeQuote(
      [
        {
          roomIndex: 0,
          roomLabel: "Living Room",
          widthCm: 280,
          dayPrice: ESSENTIAL,
          nightPrice: null,
          addons: [S_FOLD],
        },
      ],
      ASSUMPTIONS,
    );
    // fabric 28560 + s-fold 3080. The 7000 rail is counted separately.
    expect(q.cogsRooms[0].items[0].rmbCents).toBe(31640);
    expect(q.cogsExtras).toEqual([
      { label: "Track (single)", count: 1, rmbCents: 7000 },
    ]);
  });

  it("counts the rails once for the whole order, not once per window", () => {
    const win = (roomIndex: number) => ({
      roomIndex,
      roomLabel: `Room ${roomIndex + 1}`,
      widthCm: 200,
      dayPrice: ESSENTIAL,
      nightPrice: null,
      addons: [],
    });
    const q = computeQuote(
      [win(0), win(1), win(2), win(3)],
      ASSUMPTIONS,
    );
    // Four windows, one rail each: ONE line of four, not four lines.
    // 2.0m × ¥25 apiece.
    expect(q.cogsExtras).toEqual([
      { label: "Track (single)", count: 4, rmbCents: 4 * 5000 },
    ]);
  });

  it("keeps single and double rails on separate lines — different hardware", () => {
    const single = {
      roomIndex: 0,
      roomLabel: "Living Room",
      widthCm: 200,
      dayPrice: ESSENTIAL,
      nightPrice: null,
      addons: [],
    };
    const double = { ...single, nightPrice: NIGHT };
    const q = computeQuote([single, double, double], ASSUMPTIONS);
    // Single: 2.0m × ¥25 = 5000. Double: two runs, 2 × 2.0m × ¥25 = 10000 each.
    expect(q.cogsExtras).toEqual([
      { label: "Track (single)", count: 1, rmbCents: 5000 },
      { label: "Track (double)", count: 2, rmbCents: 20000 },
    ]);
  });

  it("a blind contributes no rail — it carries its own headrail", () => {
    const q = computeQuote(
      [
        {
          roomIndex: 0,
          roomLabel: "Bedroom",
          widthCm: 150,
          blindPrice: { ...SIGNATURE, label: "Korean Combi" },
          addons: [],
        },
      ],
      ASSUMPTIONS,
    );
    expect(q.cogsExtras).toEqual([]);
  });

  it("keeps two rooms of the same name apart", () => {
    const win = (roomIndex: number) => ({
      roomIndex,
      roomLabel: "Bedroom",
      widthCm: 200,
      dayPrice: ESSENTIAL,
      addons: [],
    });
    const q = computeQuote([win(0), win(1)], ASSUMPTIONS);
    expect(q.cogsRooms).toHaveLength(2);
    expect(q.cogsRooms.every((r) => r.items.length === 1)).toBe(true);
  });

  it("falls back to the room's number when it hasn't been named", () => {
    const q = computeQuote(
      [
        {
          roomIndex: 2,
          roomLabel: null,
          widthCm: 200,
          dayPrice: ESSENTIAL,
          addons: [],
        },
      ],
      ASSUMPTIONS,
    );
    expect(q.cogsRooms[0].label).toBe("Room 3");
  });

  it("neither other cost nor GST appears as a room — they are charged ON the COGS", () => {
    const q = order();
    expect(q.otherCostRmbCents).toBe(Math.round((q.cogsRmbCents * 1000) / 10000));
    expect(q.gstRmbCents).toBe(Math.round((q.cogsRmbCents * 900) / 10000));
    expect(q.grossCostRmbCents).toBe(
      q.cogsRmbCents + q.freightRmbCents + q.otherCostRmbCents + q.gstRmbCents,
    );
  });
});

describe("computeQuote", () => {
  it("rolls a window up through freight / other / GST / handyman to a margin", () => {
    const q = computeQuote(
      [
        {
          widthCm: 280,
          dayPrice: SIGNATURE,
          nightPrice: null,
          addons: [S_FOLD],
        },
      ],
      ASSUMPTIONS,
    );
    expect(q.cogsRmbCents).toBe(38640); // fabric 28560 + s-fold 3080 + rail 7000
    expect(q.saleSgdCents).toBe(47600); // fabric + s-fold; the rail is not sold
    expect(q.freightRmbCents).toBe(50000); // clamped to the ¥500 floor
    expect(q.otherCostRmbCents).toBe(3864);
    expect(q.gstRmbCents).toBe(3478);
    expect(q.grossCostRmbCents).toBe(95982);
    expect(q.grossCostSgdCents).toBe(18110);
    // single-curtain install $60 (not the flat handyman)
    expect(q.installationSgdCents).toBe(6000);
    expect(q.netCostSgdCents).toBe(24110);
    expect(q.marginBps).toBe(4935); // 49.35%
    expect(q.groupbuySgdCents).toBe(40460);
    expect(q.groupbuyMarginBps).toBe(4041); // 40.41%
  });

  it("adds the ad-hoc extra install cost", () => {
    const win = {
      widthCm: 280,
      dayPrice: SIGNATURE,
      nightPrice: null,
      addons: [S_FOLD],
    };
    const base = computeQuote([win], ASSUMPTIONS, "air");
    const withExtra = computeQuote([win], ASSUMPTIONS, "air", 5000);
    expect(withExtra.installationSgdCents).toBe(base.installationSgdCents + 5000);
    expect(withExtra.netCostSgdCents).toBe(base.netCostSgdCents + 5000);
  });

  it("an order-level discount reduces the sale + margin, not the cost", () => {
    const win = {
      widthCm: 280,
      dayPrice: SIGNATURE,
      nightPrice: null,
      addons: [S_FOLD],
    };
    const base = computeQuote([win], ASSUMPTIONS, "air");
    const disc = computeQuote([win], ASSUMPTIONS, "air", 0, 1500); // −15%
    // Pre-discount sale is preserved; the discounted sale is 85% of it.
    expect(disc.saleSgdCents).toBe(base.saleSgdCents);
    expect(disc.discountedSaleSgdCents).toBe(
      Math.round((base.saleSgdCents * 8500) / 10000),
    );
    // Cost is untouched, so the (lower) discounted sale means a lower margin.
    expect(disc.netCostSgdCents).toBe(base.netCostSgdCents);
    expect(disc.marginBps).toBeLessThan(base.marginBps);
    expect(disc.marginBps).toBe(
      marginBps(disc.netCostSgdCents, disc.discountedSaleSgdCents),
    );
    // Groupbuy derives from the discounted sale.
    expect(disc.groupbuySgdCents).toBe(
      Math.round(
        (disc.discountedSaleSgdCents *
          (10000 - ASSUMPTIONS.groupbuyDiscountBps)) /
          10000,
      ),
    );
  });

  it("a combo and an order discount compose", () => {
    const win = {
      widthCm: 300,
      dayPrice: SIGNATURE,
      nightPrice: SIGNATURE,
      addons: [],
      comboPriceSgdCents: 45000,
    };
    const q = computeQuote([win], ASSUMPTIONS, "air", 0, 1000); // −10%
    // Combo fixes the per-window sale; the promo then discounts the order total.
    expect(q.saleSgdCents).toBe(45000);
    expect(q.discountedSaleSgdCents).toBe(Math.round((45000 * 9000) / 10000));
    expect(q.marginBps).toBe(
      marginBps(q.netCostSgdCents, q.discountedSaleSgdCents),
    );
  });

  it("a curtain package replaces covering sale but keeps measured add-ons", () => {
    const win = {
      widthCm: 300,
      dayPrice: SIGNATURE,
      nightPrice: SIGNATURE,
      addons: [S_FOLD],
    };
    const q = computeQuote([win], ASSUMPTIONS, "air", 0, 0, 76_800);
    expect(q.saleSgdCents).toBe(76_800 + 24_000);
  });

  it("with no discount, discountedSale equals sale (unchanged behaviour)", () => {
    const win = {
      widthCm: 280,
      dayPrice: SIGNATURE,
      nightPrice: null,
      addons: [S_FOLD],
    };
    const q = computeQuote([win], ASSUMPTIONS);
    expect(q.discountedSaleSgdCents).toBe(q.saleSgdCents);
    expect(q.marginBps).toBe(marginBps(q.netCostSgdCents, q.saleSgdCents));
  });

  it("returns zeros for an empty order", () => {
    const q = computeQuote([], ASSUMPTIONS);
    expect(q.cogsRmbCents).toBe(0);
    expect(q.saleSgdCents).toBe(0);
    expect(q.marginBps).toBe(0);
  });

  it("uses a flat sea freight when shipping by sea", () => {
    const win = {
      widthCm: 280,
      dayPrice: SIGNATURE,
      nightPrice: null,
      addons: [S_FOLD],
    };
    const air = computeQuote([win], ASSUMPTIONS, "air");
    const sea = computeQuote([win], ASSUMPTIONS, "sea");
    expect(air.freightRmbCents).toBe(50000); // air clamps to the ¥500 floor
    expect(sea.freightRmbCents).toBe(40000); // sea is a flat ¥400
    // Sea is cheaper here → lower net cost → better margin.
    expect(sea.netCostSgdCents).toBeLessThan(air.netCostSgdCents);
  });
});

describe("marginBps", () => {
  it("computes 1 − netCost/sale in basis points", () => {
    expect(marginBps(6000, 10000)).toBe(4000); // 40%
  });
  it("is 0 when sale is 0", () => {
    expect(marginBps(500, 0)).toBe(0);
  });
});

// ── Blinds (Phase 12) ─────────────────────────────────────────────────────
//
// A blind prices per metre of width like a curtain, but WITHOUT the style
// multiplier, add-ons or track, and installs at its own handyman rate.

const BLIND = { costRmbCents: 4000, saleSgdCents: 7000 }; // ¥40 / S$70 per m

// Blind-scoped add-ons, as the resolver hands them over.
const BLACKOUT = {
  label: "Blackout",
  costRmbCents: 2700,
  saleSgdCents: 5000,
  basis: "per_metre" as const,
};
const SHIPPING = {
  label: "Extra shipping",
  costRmbCents: null,
  saleSgdCents: 13000,
  basis: "per_unit" as const,
};

describe("windowQuote — no covering, no add-on", () => {
  // A blind window with no type picked yet falls through to the CURTAIN path
  // (windowQuote branches on blindPrice, not on the variant), carrying whatever
  // the resolver decided. Without this rule it charges a per-unit add-on while
  // reporting offering: "none". Per-metre add-ons hide it — addonLeg returns
  // zero without a width — so extra_shipping is the first one that would bite.
  it("charges nothing on a window with nothing in it", () => {
    const q = windowQuote({ widthCm: 230, addons: [SHIPPING] }, ASSUMPTIONS);
    expect(q.offering).toBe("none");
    expect(q.costRmbCents).toBe(0);
    expect(q.saleSgdCents).toBe(0);
    expect(q.legs).toEqual([]);
  });

  it("charges nothing on a measured but unpriced curtain window", () => {
    const q = windowQuote(
      { widthCm: 230, dayPrice: null, nightPrice: null, addons: [SHIPPING] },
      ASSUMPTIONS,
    );
    expect(q.saleSgdCents).toBe(0);
  });
});

describe("windowQuote — blinds", () => {
  it("prices by width with NO style multiplier on cost", () => {
    const q = windowQuote(
      { widthCm: 200, blindPrice: BLIND, addons: [] },
      ASSUMPTIONS,
    );

    // 2.0m × ¥40 = ¥80. A curtain would be ¥160 here (×2.0 fullness).
    expect(q.costRmbCents).toBe(8000);
    expect(q.saleSgdCents).toBe(14000); // 2.0m × S$70
    expect(q.offering).toBe("blind");
  });

  it("adds no track, whatever else it carries", () => {
    // A blind carries its own headrail. This was previously bundled with "and
    // no add-ons either" — that half moved to the resolver in Phase 14, which
    // keeps a curtain-scoped add-on off a blind by SCOPE. The calculator now
    // trusts what it is handed, so the two facts are tested apart.
    const q = windowQuote(
      { widthCm: 200, blindPrice: BLIND, addons: [BLACKOUT] },
      ASSUMPTIONS,
    );
    expect(q.trackRmbCents).toBe(0);
    expect(q.trackKind).toBeNull();
  });

  it("ignores a combo price — combos are a curtain bundle", () => {
    const q = windowQuote(
      {
        widthCm: 200,
        blindPrice: BLIND,
        addons: [],
        comboPriceSgdCents: 999_00,
      },
      ASSUMPTIONS,
    );
    expect(q.saleSgdCents).toBe(14000);
  });

  it("counts blind cost toward the air-freight base", () => {
    const q = windowQuote(
      { widthCm: 200, blindPrice: BLIND, addons: [] },
      ASSUMPTIONS,
    );
    expect(q.curtainCostRmbCents).toBe(8000);
  });

  it("is 'none' — and free — when unmeasured", () => {
    const q = windowQuote(
      { widthCm: null, blindPrice: BLIND, addons: [] },
      ASSUMPTIONS,
    );
    expect(q.offering).toBe("none");
    expect(q.costRmbCents).toBe(0);
    expect(q.saleSgdCents).toBe(0);
  });

  it("charges a per-metre add-on", () => {
    const q = windowQuote(
      { widthCm: 200, blindPrice: BLIND, addons: [BLACKOUT] },
      ASSUMPTIONS,
    );
    // blind 2m × ¥40 = ¥80, blackout 2m × ¥27 = ¥54
    expect(q.costRmbCents).toBe(8000 + 5400);
    expect(q.saleSgdCents).toBe(14000 + 10000);
  });

  it("charges a per-unit add-on flat", () => {
    const q = windowQuote(
      { widthCm: 230, blindPrice: BLIND, addons: [SHIPPING] },
      ASSUMPTIONS,
    );
    expect(q.saleSgdCents).toBe(Math.round(2.3 * 7000) + 13000);
  });

  it("keeps add-on cost out of the air-freight base", () => {
    const q = windowQuote(
      { widthCm: 200, blindPrice: BLIND, addons: [BLACKOUT] },
      ASSUMPTIONS,
    );
    // curtainCostRmbCents is the freight base: the covering alone.
    expect(q.curtainCostRmbCents).toBe(8000);
  });

  it("emits a leg per add-on, alongside its own", () => {
    const q = windowQuote(
      { widthCm: 200, blindPrice: BLIND, addons: [BLACKOUT] },
      ASSUMPTIONS,
    );
    expect(q.legs.map((l) => l.label)).toEqual(["Blind", "Blackout"]);
  });

  it("charges no add-on when unmeasured, per-unit included", () => {
    const q = windowQuote(
      { widthCm: null, blindPrice: BLIND, addons: [SHIPPING] },
      ASSUMPTIONS,
    );
    expect(q.saleSgdCents).toBe(0);
    expect(q.costRmbCents).toBe(0);
  });

  it("keeps its add-ons while still ignoring a combo", () => {
    const q = windowQuote(
      {
        widthCm: 200,
        blindPrice: BLIND,
        addons: [BLACKOUT],
        comboPriceSgdCents: 999_00,
      },
      ASSUMPTIONS,
    );
    expect(q.saleSgdCents).toBe(14000 + 10000);
  });

  it("never prices a curtain leg on a blind window", () => {
    // Stale day/night prices left over from a switched window must not add up.
    const q = windowQuote(
      {
        widthCm: 200,
        blindPrice: BLIND,
        dayPrice: SIGNATURE,
        nightPrice: SIGNATURE,
        addons: [],
      },
      ASSUMPTIONS,
    );
    expect(q.saleSgdCents).toBe(14000);
    expect(q.costRmbCents).toBe(8000);
  });
});

// ── Manufacturing width (Phase 13B) ───────────────────────────────────────
//
// Once a manufacturing set is confirmed, the vendor cuts a piece SMALLER than
// the opening (curtains: −2 cm wide). COGS must follow what is actually being
// made — but the sale must not, because that is the price the customer already
// agreed and paid a deposit against.

describe("costWidthCm", () => {
  // 3.02m measured: both widths below round UP to a tenth of a metre on the
  // cost side, so the pair has to straddle a boundary for the manufacturing
  // width to show up at all. See the test after this one.
  const base = {
    widthCm: 302,
    dayPrice: SIGNATURE,
    addons: [],
  };

  it("lowers the cost and leaves the sale exactly where it was", () => {
    const measured = windowQuote(base, ASSUMPTIONS);
    const made = windowQuote(
      { ...base, costWidthCm: 300 },
      ASSUMPTIONS,
    );

    // Cut at 3.00m: 3.00 × 2.0 × ¥51 = ¥306.00, against the measured 3.02m
    // rounded up to 3.10 → ¥316.20.
    expect(made.curtainCostRmbCents).toBe(30600);
    expect(measured.curtainCostRmbCents).toBe(31620);
    expect(made.costRmbCents).toBeLessThan(measured.costRmbCents);
    // The customer's number does not move — and is not rounded: 3.02m × S$90.
    expect(made.saleSgdCents).toBe(measured.saleSgdCents);
    expect(made.saleSgdCents).toBe(27180);
  });

  it("changes nothing when the allowance stays inside the same tenth", () => {
    // The normal curtain case: 2 cm off a 3.00m opening. Both widths cost at
    // 3.00m, so a confirmed set leaves COGS exactly where it was. The allowance
    // still governs what is CUT; it is only invisible to the money.
    const win = { ...base, widthCm: 300 };
    expect(windowQuote({ ...win, costWidthCm: 298 }, ASSUMPTIONS)).toEqual(
      windowQuote(win, ASSUMPTIONS),
    );
  });

  it("is byte-identical to today when absent", () => {
    // The expectations are lifted verbatim from the day-only 2.8m window above.
    const today = {
      costRmbCents: 38640,
      saleSgdCents: 47600,
      curtainCostRmbCents: 28560,
      offering: "single",
      trackRmbCents: 7000,
      trackKind: "single",
      legs: [
        { label: "Day curtain", detail: null, rmbCents: 28560 },
        { label: "S-Fold", detail: null, rmbCents: 3080 },
      ],
    };
    const win = {
      widthCm: 280,
      dayPrice: SIGNATURE,
      nightPrice: null,
      addons: [S_FOLD],
    };
    // Omitted (no confirmed set) and explicitly null (a row that never arrived)
    // must both behave as they did before the field existed.
    expect(windowQuote(win, ASSUMPTIONS)).toEqual(today);
    expect(
      windowQuote(
        { ...win, costWidthCm: null },
        ASSUMPTIONS,
      ),
    ).toEqual(today);
  });

  it("applies to the night leg as well as the day leg", () => {
    const q = windowQuote(
      { ...base, nightPrice: SIGNATURE, costWidthCm: 300 },
      ASSUMPTIONS,
    );
    // Both legs cut at 3.00m: 2 × ¥306.00.
    expect(q.curtainCostRmbCents).toBe(2 * 30600);
    expect(q.saleSgdCents).toBe(54360); // 2 × 3.02m × S$90
  });

  it("applies to the blind leg", () => {
    const made = windowQuote(
      {
        widthCm: 202,
        costWidthCm: 198,
        blindPrice: BLIND,
        addons: [],
      },
      ASSUMPTIONS,
    );
    expect(made.costRmbCents).toBe(8000); // 1.98m → 2.00m × ¥40
    expect(made.saleSgdCents).toBe(14140); // still the measured 2.02m × S$70
  });

  it("costs per-metre add-ons on the manufacturing width, sells them on the measured one", () => {
    const win = {
      widthCm: 282,
      dayPrice: SIGNATURE,
      addons: [S_FOLD, SLIM],
    };
    const made = windowQuote(
      { ...win, costWidthCm: 278 },
      ASSUMPTIONS,
    );
    const measured = windowQuote(win, ASSUMPTIONS);

    // Cut at 2.78m → costed at 2.80: fabric 2.80×2×5100=28560,
    // s-fold 2.80×1100=3080, slim tracks 2.80×3500=9800. Measured 2.82m →
    // costed at 2.90 throughout. The rail bills on the exact MEASURED 2.82m
    // either way — it is cut to the opening, not to the panel.
    expect(made.costRmbCents).toBe(28560 + 3080 + 9800 + 7050);
    expect(measured.costRmbCents).toBe(29580 + 3190 + 10150 + 7050);
    // Sale: fabric 25380 + s-fold 22560 + slim tracks 14100, both times, all
    // on the exact 2.82m.
    expect(made.saleSgdCents).toBe(62040);
    expect(measured.saleSgdCents).toBe(62040);
  });

  it("leaves a per-unit add-on flat whatever either width says", () => {
    const perUnit = {
      label: "S-Fold",
      costRmbCents: 1100,
      saleSgdCents: 8000,
      basis: "per_unit" as const,
    };
    const win = { ...base, costWidthCm: 150 }; // an absurd gap, to make a scaling bug loud
    const off = windowQuote(win, ASSUMPTIONS);
    const on = windowQuote({ ...win, addons: [perUnit] }, ASSUMPTIONS);
    expect(on.costRmbCents - off.costRmbCents).toBe(1100);
    expect(on.saleSgdCents - off.saleSgdCents).toBe(8000);
    // The rail bills on the EXACT measured 3.02m — neither the absurd
    // manufacturing width nor the cost side's round-up moves it: 3.02 × ¥25.
    expect(on.trackRmbCents).toBe(7550);
  });

  it("still lets a combo fix the sale while cost follows the manufacturing width", () => {
    const q = windowQuote(
      {
        ...base,
        nightPrice: SIGNATURE,
        costWidthCm: 300,
        comboPriceSgdCents: 45000,
      },
      ASSUMPTIONS,
    );
    expect(q.saleSgdCents).toBe(45000);
    expect(q.curtainCostRmbCents).toBe(2 * 30600);
  });

  it("still applies the style multiplier to cost only", () => {
    const win = { ...base, costWidthCm: 300 };
    const double = windowQuote(win, {
      ...ASSUMPTIONS,
      styleMultiplier: 20000,
    });
    const triple = windowQuote(win, {
      ...ASSUMPTIONS,
      styleMultiplier: 30000,
    });
    expect(double.curtainCostRmbCents).toBe(30600); // 3.00 × 2.0 × 5100
    expect(triple.curtainCostRmbCents).toBe(45900); // 3.00 × 3.0 × 5100
    expect(triple.saleSgdCents).toBe(double.saleSgdCents);
  });

  // The zero-guards still key off the MEASURED width alone. An unmeasured
  // window is free on both sides; a missing or nonsensical manufacturing width
  // falls back to the measured one rather than zeroing COGS, because a zero
  // cost would report a ~100% margin — a far more dangerous wrong answer.
  it("stays free on an unmeasured window even with a manufacturing width", () => {
    expect(
      windowQuote(
        { widthCm: null, costWidthCm: 298, dayPrice: SIGNATURE, addons: [S_FOLD, SLIM] },
        ASSUMPTIONS,
      ),
    ).toEqual({
      costRmbCents: 0,
      saleSgdCents: 0,
      curtainCostRmbCents: 0,
      offering: "none",
      trackRmbCents: 0,
      trackKind: null,
      legs: [],
    });
  });

  it("falls back to the measured width when the manufacturing one is nonsense", () => {
    const measured = windowQuote(base, ASSUMPTIONS);
    for (const costWidthCm of [0, -5]) {
      expect(
        windowQuote({ ...base, costWidthCm }, ASSUMPTIONS),
      ).toEqual(measured);
    }
  });
});

describe("installation cost by offering", () => {
  const measure = (win: Parameters<typeof computeQuote>[0][number]) =>
    computeQuote([win], ASSUMPTIONS, "sea", 0, 0).installationSgdCents;

  it("charges the blinds rate for a blind window", () => {
    expect(
      measure({
        widthCm: 200,
        blindPrice: BLIND,
        addons: [],
      }),
    ).toBe(ASSUMPTIONS.handymanBlindsSgdCents);
  });

  it("still charges single and double rates for curtains", () => {
    expect(
      measure({
        widthCm: 200,
        dayPrice: SIGNATURE,
        addons: [],
      }),
    ).toBe(ASSUMPTIONS.handymanSingleSgdCents);
    expect(
      measure({
        widthCm: 200,
        dayPrice: SIGNATURE,
        nightPrice: SIGNATURE,
        addons: [],
      }),
    ).toBe(ASSUMPTIONS.handymanDoubleSgdCents);
  });

  it("charges nothing for an unmeasured blind", () => {
    expect(
      measure({
        widthCm: null,
        blindPrice: BLIND,
        addons: [],
      }),
    ).toBe(0);
  });

  it("charges both rates on a mixed curtain + blind order", () => {
    const total = computeQuote(
      [
        { widthCm: 200, dayPrice: SIGNATURE, nightPrice: SIGNATURE, addons: [] },
        { widthCm: 200, blindPrice: BLIND, addons: [] },
      ],
      ASSUMPTIONS,
      "sea",
      0,
      0,
    ).installationSgdCents;
    expect(total).toBe(
      ASSUMPTIONS.handymanDoubleSgdCents + ASSUMPTIONS.handymanBlindsSgdCents,
    );
  });
});

// ── The rail, per metre ───────────────────────────────────────────────────
//
// It used to be a flat per-unit charge that ignored the window entirely, and
// the per-metre option in the admin screen silently zeroed it. One rate, on the
// MEASURED width — the rail is cut to the opening it is screwed above, not to
// the panel the vendor cuts.

describe("track", () => {
  const win = (over: Partial<Parameters<typeof windowQuote>[0]> = {}) => ({
    widthCm: 240,
    dayPrice: SIGNATURE,
    addons: [],
    ...over,
  });

  it("bills a single rail at width × rate", () => {
    // 2.40m × ¥25.
    expect(windowQuote(win(), ASSUMPTIONS).trackRmbCents).toBe(6000);
  });

  it("bills a double rail at twice the width, at the SAME rate", () => {
    const single = windowQuote(win(), ASSUMPTIONS);
    const double = windowQuote(
      win({ nightPrice: SIGNATURE }),
      ASSUMPTIONS,
    );
    expect(double.trackKind).toBe("double");
    expect(double.trackRmbCents).toBe(2 * single.trackRmbCents);
  });

  it("follows the width, where the old flat charge did not", () => {
    const narrow = windowQuote(win({ widthCm: 100 }), ASSUMPTIONS);
    const wide = windowQuote(win({ widthCm: 300 }), ASSUMPTIONS);
    expect(narrow.trackRmbCents).toBe(2500);
    expect(wide.trackRmbCents).toBe(7500);
  });

  it("bills on the measured width, never the manufacturing one", () => {
    const made = windowQuote(
      win({ costWidthCm: 100 }), // an absurd gap, to make a mix-up loud
      ASSUMPTIONS,
    );
    expect(made.trackRmbCents).toBe(6000); // still 2.40m
  });

  it("is free when the rate is zero, and charges nothing on a blind", () => {
    const free = windowQuote(win(), {
      ...ASSUMPTIONS,
      trackCostRmbCentsPerM: 0,
    });
    expect(free.trackRmbCents).toBe(0);
    const blind = windowQuote(
      { widthCm: 240, blindPrice: BLIND, addons: [] },
      ASSUMPTIONS,
    );
    // A blind carries its own headrail.
    expect(blind.trackRmbCents).toBe(0);
  });

  it("stays out of the customer's price whatever the width", () => {
    const narrow = windowQuote(win({ widthCm: 100 }), ASSUMPTIONS);
    const wide = windowQuote(win({ widthCm: 100 }), {
      ...ASSUMPTIONS,
      trackCostRmbCentsPerM: 100_000,
    });
    expect(wide.saleSgdCents).toBe(narrow.saleSgdCents);
  });
});

// ── What a window is made of ──────────────────────────────────────────────
//
// The room's subtotal says which room carries the cost; the legs say which
// COVERING inside a window carries it — the day curtain, the night curtain, the
// S-Fold over them.

describe("cost breakdown — legs", () => {
  const ESSENTIAL_L = { ...SIGNATURE, label: "Essential" };
  const SIGNATURE_L = { ...SIGNATURE, label: "Signature" };

  const legsOf = (win: Parameters<typeof computeQuote>[0][number]) =>
    computeQuote([win], ASSUMPTIONS).cogsRooms[0].items[0].legs;

  it("splits a day + night window into its two curtains", () => {
    expect(
      legsOf({
        widthCm: 300,
        dayPrice: ESSENTIAL_L,
        nightPrice: ESSENTIAL_L,
        addons: [],
      }),
    ).toEqual([
      // One series across both, so the window's own row already names it.
      { label: "Day curtain", detail: null, rmbCents: 30600 },
      { label: "Night curtain", detail: null, rmbCents: 30600 },
    ]);
  });

  it("names the series on each leg when the two differ", () => {
    expect(
      legsOf({
        widthCm: 300,
        dayPrice: ESSENTIAL_L,
        nightPrice: SIGNATURE_L,
        addons: [],
      })?.map((l) => l.detail),
    ).toEqual(["Essential", "Signature"]);
  });

  it("lists the add-ons beside the curtains, in charge order", () => {
    expect(
      legsOf({
        widthCm: 280,
        dayPrice: ESSENTIAL_L,
        addons: [S_FOLD, SLIM],
      })?.map((l) => l.label),
    ).toEqual(["Day curtain", "S-Fold", "Slim tracks"]);
  });

  it("has none when the window is a single covering — nothing to break down", () => {
    expect(
      legsOf({
        widthCm: 280,
        dayPrice: ESSENTIAL_L,
        addons: [],
      }),
    ).toBeUndefined();
    expect(
      legsOf({
        widthCm: 150,
        blindPrice: { ...SIGNATURE, label: "Korean Combi" },
        addons: [],
      }),
    ).toBeUndefined();
  });

  it("sums to the window's own figure — the rail excluded, as on the row", () => {
    const q = computeQuote(
      [
        {
          widthCm: 280,
          dayPrice: ESSENTIAL_L,
          nightPrice: SIGNATURE_L,
          addons: [S_FOLD, SLIM],
        },
      ],
      ASSUMPTIONS,
    );
    const item = q.cogsRooms[0].items[0];
    expect((item.legs ?? []).reduce((n, l) => n + l.rmbCents, 0)).toBe(
      item.rmbCents,
    );
    // And the rail is on its own line, outside the window.
    expect(q.cogsExtras).toEqual([
      { label: "Track (double)", count: 1, rmbCents: 14000 },
    ]);
  });
});

// ── The markups' base ─────────────────────────────────────────────────────

describe("finaliseQuote — what other cost and GST are charged on", () => {
  it("charges both on COGS alone, never on freight", () => {
    const q = computeQuote(
      [
        {
          widthCm: 280,
          dayPrice: SIGNATURE,
          addons: [],
        },
      ],
      ASSUMPTIONS,
      "sea", // a flat ¥400, so the base is obvious either way
    );
    expect(q.otherCostRmbCents).toBe(
      Math.round((q.cogsRmbCents * ASSUMPTIONS.otherCostBps) / 10000),
    );
    expect(q.gstRmbCents).toBe(
      Math.round((q.cogsRmbCents * ASSUMPTIONS.gstBps) / 10000),
    );
    // The freight, had it been in either base, would have moved them.
    expect(q.freightRmbCents).toBe(40000);
  });

  it("echoes the rates and the freight mode back, so a breakdown can say so", () => {
    const win = {
      widthCm: 280,
      dayPrice: SIGNATURE,
      addons: [],
    };
    const air = computeQuote([win], ASSUMPTIONS, "air");
    const sea = computeQuote([win], ASSUMPTIONS, "sea");
    expect(air.freightMode).toBe("air");
    expect(sea.freightMode).toBe("sea");
    expect(air.otherCostBps).toBe(ASSUMPTIONS.otherCostBps);
    expect(air.gstBps).toBe(ASSUMPTIONS.gstBps);
  });
});

// ── Costing rounds the width up ───────────────────────────────────────────
//
// We are billed in tenths of a metre, so 2.67 m of fabric is bought as 2.70.
// COST ONLY: the customer is charged on the exact measured width.

describe("ceilToTenCm", () => {
  it("rounds up to the next tenth of a metre", () => {
    expect(ceilToTenCm(267)).toBe(270);
    expect(ceilToTenCm(261)).toBe(270);
  });

  it("leaves a width already on a tenth alone", () => {
    expect(ceilToTenCm(260)).toBe(260);
    expect(ceilToTenCm(0)).toBe(0);
  });
});

describe("costing width", () => {
  const win = (over = {}) => ({
    widthCm: 267,
    dayPrice: SIGNATURE,
    addons: [S_FOLD],
    ...over,
  });

  it("costs the fabric at the next tenth up", () => {
    // 2.70m × 2.0 × ¥51, not 2.67.
    expect(windowQuote(win(), ASSUMPTIONS).curtainCostRmbCents).toBe(
      27540,
    );
  });

  it("costs per-metre add-ons at the next tenth up too", () => {
    const q = windowQuote(win(), ASSUMPTIONS);
    // s-fold 2.70 × ¥11 = ¥29.70, on top of the fabric.
    expect(q.costRmbCents - q.curtainCostRmbCents - q.trackRmbCents).toBe(2970);
  });

  it("sells at the exact measured width — this is a cost rule only", () => {
    // 2.67m × S$90 fabric + 2.67m × S$80 s-fold. Not a cent of rounding.
    expect(windowQuote(win(), ASSUMPTIONS).saleSgdCents).toBe(
      24030 + 21360,
    );
  });

  it("leaves the rail on the exact width — a rail is cut, not bought by the tenth", () => {
    expect(windowQuote(win(), ASSUMPTIONS).trackRmbCents).toBe(6675);
  });

  it("rounds a blind's cost the same way", () => {
    const q = windowQuote(
      { widthCm: 267, blindPrice: BLIND, addons: [] },
      ASSUMPTIONS,
    );
    expect(q.costRmbCents).toBe(10800); // 2.70m × ¥40
    expect(q.saleSgdCents).toBe(18690); // 2.67m × S$70
  });

  it("keeps an unmeasured window free rather than rounding it up to nothing", () => {
    const q = windowQuote(
      { widthCm: null, dayPrice: SIGNATURE, addons: [S_FOLD, SLIM] },
      ASSUMPTIONS,
    );
    expect(q.costRmbCents).toBe(0);
  });
});
