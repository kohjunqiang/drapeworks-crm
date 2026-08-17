import { describe, expect, it } from "vitest";

import {
  computeQuote,
  marginBps,
  windowQuote,
  type CalcAddonBook,
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
};

const BOOK: CalcAddonBook = {
  sFold: { costRmbCents: 1100, saleSgdCents: 8000, basis: "per_metre" },
  slimTracks: { costRmbCents: 3500, saleSgdCents: 5000, basis: "per_metre" },
  singleTrack: { costRmbCents: 2500, saleSgdCents: 3500, basis: "per_unit" },
  doubleTrack: { costRmbCents: 2500, saleSgdCents: 4000, basis: "per_unit" },
};

const SIGNATURE = { costRmbCents: 5100, saleSgdCents: 9000 }; // ¥51 / S$90 per m

describe("windowQuote", () => {
  it("prices a day-only 2.8m window with S-Fold + single track", () => {
    const q = windowQuote(
      {
        widthCm: 280,
        dayPrice: SIGNATURE,
        nightPrice: null,
        addSFold: true,
        addSlimTracks: false,
      },
      BOOK,
      ASSUMPTIONS.styleMultiplier,
    );
    // day cost 2.8×2×5100=28560, sale 2.8×9000=25200
    // s-fold cost 2.8×1100=3080, sale 2.8×8000=22400
    // single track cost 2500 (into COGS); its sale is NOT billed to the customer.
    // sale = fabric 25200 + s-fold 22400 = 47600; curtain-only cost = day 28560
    expect(q).toEqual({
      costRmbCents: 34140,
      saleSgdCents: 47600,
      curtainCostRmbCents: 28560,
      offering: "single",
      // Reported apart so the breakdown can list the rails on their own line.
      trackRmbCents: 2500,
      trackKind: "single",
    });
  });

  it("uses a double track when both day + night are present", () => {
    const q = windowQuote(
      {
        widthCm: 300,
        dayPrice: SIGNATURE,
        nightPrice: SIGNATURE,
        addSFold: false,
        addSlimTracks: false,
      },
      BOOK,
      ASSUMPTIONS.styleMultiplier,
    );
    // day+night cost 2×(3×2×5100)=61200, sale 2×(3×9000)=54000
    // double track cost 2500 (into COGS); its sale is NOT billed to the customer.
    // sale = fabric 54000 only; curtain-only cost = 61200
    expect(q).toEqual({
      costRmbCents: 63700,
      saleSgdCents: 54000,
      curtainCostRmbCents: 61200,
      offering: "double",
      trackRmbCents: 2500,
      trackKind: "double",
    });
  });

  it("keeps the track out of the customer quote but in COGS (it's a cost, not a customer line)", () => {
    const q = windowQuote(
      {
        widthCm: 300,
        dayPrice: SIGNATURE,
        nightPrice: SIGNATURE,
        addSFold: false,
        addSlimTracks: false,
      },
      BOOK,
      ASSUMPTIONS.styleMultiplier,
    );
    // Sale is fabric only: 2×(3×9000)=54000 — the S$40 double track is NOT added.
    expect(q.saleSgdCents).toBe(54000);
    // Its cost IS still carried: day+night 61200 + track cost 2500 = 63700.
    expect(q.costRmbCents).toBe(63700);
  });

  it("a combo overrides the sale but leaves cost/COGS unchanged", () => {
    const base = {
      widthCm: 300,
      dayPrice: SIGNATURE,
      nightPrice: SIGNATURE,
      addSFold: false,
      addSlimTracks: false,
    };
    const plain = windowQuote(base, BOOK, ASSUMPTIONS.styleMultiplier);
    const combo = windowQuote(
      { ...base, comboPriceSgdCents: 45000 }, // S$450 bundle
      BOOK,
      ASSUMPTIONS.styleMultiplier,
    );
    // Sale is fixed to the bundle price; every cost figure is identical.
    expect(combo.saleSgdCents).toBe(45000);
    expect(combo.costRmbCents).toBe(plain.costRmbCents);
    expect(combo.curtainCostRmbCents).toBe(plain.curtainCostRmbCents);
    expect(combo.offering).toBe(plain.offering);
  });

  it("is zero for an unmeasured / unpriced window", () => {
    expect(
      windowQuote(
        { widthCm: null, addSFold: true, addSlimTracks: true },
        BOOK,
        ASSUMPTIONS.styleMultiplier,
      ),
    ).toEqual({
      costRmbCents: 0,
      saleSgdCents: 0,
      curtainCostRmbCents: 0,
      offering: "none",
      // No curtain, so no rail to buy.
      trackRmbCents: 0,
      trackKind: null,
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
          addSFold: true,
          addSlimTracks: false,
        },
        {
          roomIndex: 0,
          roomLabel: "Living Room",
          widthCm: 150,
          dayPrice: ESSENTIAL,
          nightPrice: null,
          addSFold: false,
          addSlimTracks: false,
        },
        {
          roomIndex: 1,
          roomLabel: "Bedroom",
          widthCm: 150,
          blindPrice: { ...SIGNATURE, label: "Korean Combi" },
          addSFold: false,
          addSlimTracks: false,
        },
      ],
      BOOK,
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
          addSFold: false,
          addSlimTracks: false,
        },
      ],
      BOOK,
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
          addSFold: false,
          addSlimTracks: false,
        },
      ],
      BOOK,
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
          addSFold: true,
          addSlimTracks: false,
        },
      ],
      BOOK,
      ASSUMPTIONS,
    );
    // fabric 28560 + s-fold 3080. The 2500 rail is counted separately.
    expect(q.cogsRooms[0].items[0].rmbCents).toBe(31640);
    expect(q.cogsExtras).toEqual([
      { label: "Track (single)", count: 1, rmbCents: 2500 },
    ]);
  });

  it("counts the rails once for the whole order, not once per window", () => {
    const win = (roomIndex: number) => ({
      roomIndex,
      roomLabel: `Room ${roomIndex + 1}`,
      widthCm: 200,
      dayPrice: ESSENTIAL,
      nightPrice: null,
      addSFold: false,
      addSlimTracks: false,
    });
    const q = computeQuote(
      [win(0), win(1), win(2), win(3)],
      BOOK,
      ASSUMPTIONS,
    );
    // Four windows, one rail each: ONE line of four, not four lines.
    expect(q.cogsExtras).toEqual([
      { label: "Track (single)", count: 4, rmbCents: 4 * 2500 },
    ]);
  });

  it("keeps single and double rails on separate lines — different hardware", () => {
    const single = {
      roomIndex: 0,
      roomLabel: "Living Room",
      widthCm: 200,
      dayPrice: ESSENTIAL,
      nightPrice: null,
      addSFold: false,
      addSlimTracks: false,
    };
    const double = { ...single, nightPrice: NIGHT };
    const q = computeQuote([single, double, double], BOOK, ASSUMPTIONS);
    expect(q.cogsExtras).toEqual([
      { label: "Track (single)", count: 1, rmbCents: 2500 },
      { label: "Track (double)", count: 2, rmbCents: 5000 },
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
          addSFold: false,
          addSlimTracks: false,
        },
      ],
      BOOK,
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
      addSFold: false,
      addSlimTracks: false,
    });
    const q = computeQuote([win(0), win(1)], BOOK, ASSUMPTIONS);
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
          addSFold: false,
          addSlimTracks: false,
        },
      ],
      BOOK,
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
          addSFold: true,
          addSlimTracks: false,
        },
      ],
      BOOK,
      ASSUMPTIONS,
    );
    expect(q.cogsRmbCents).toBe(34140);
    expect(q.saleSgdCents).toBe(47600); // fabric + s-fold; track sale excluded
    expect(q.freightRmbCents).toBe(50000); // clamped to the ¥500 floor
    expect(q.otherCostRmbCents).toBe(3414);
    expect(q.gstRmbCents).toBe(3073);
    expect(q.grossCostRmbCents).toBe(90627);
    expect(q.grossCostSgdCents).toBe(17099);
    // single-curtain install $60 (not the flat handyman)
    expect(q.installationSgdCents).toBe(6000);
    expect(q.netCostSgdCents).toBe(23099);
    expect(q.marginBps).toBe(5147); // 51.47%
    expect(q.groupbuySgdCents).toBe(40460);
    expect(q.groupbuyMarginBps).toBe(4291); // 42.91%
  });

  it("adds the ad-hoc extra install cost", () => {
    const win = {
      widthCm: 280,
      dayPrice: SIGNATURE,
      nightPrice: null,
      addSFold: true,
      addSlimTracks: false,
    };
    const base = computeQuote([win], BOOK, ASSUMPTIONS, "air");
    const withExtra = computeQuote([win], BOOK, ASSUMPTIONS, "air", 5000);
    expect(withExtra.installationSgdCents).toBe(base.installationSgdCents + 5000);
    expect(withExtra.netCostSgdCents).toBe(base.netCostSgdCents + 5000);
  });

  it("an order-level discount reduces the sale + margin, not the cost", () => {
    const win = {
      widthCm: 280,
      dayPrice: SIGNATURE,
      nightPrice: null,
      addSFold: true,
      addSlimTracks: false,
    };
    const base = computeQuote([win], BOOK, ASSUMPTIONS, "air");
    const disc = computeQuote([win], BOOK, ASSUMPTIONS, "air", 0, 1500); // −15%
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
      addSFold: false,
      addSlimTracks: false,
      comboPriceSgdCents: 45000,
    };
    const q = computeQuote([win], BOOK, ASSUMPTIONS, "air", 0, 1000); // −10%
    // Combo fixes the per-window sale; the promo then discounts the order total.
    expect(q.saleSgdCents).toBe(45000);
    expect(q.discountedSaleSgdCents).toBe(Math.round((45000 * 9000) / 10000));
    expect(q.marginBps).toBe(
      marginBps(q.netCostSgdCents, q.discountedSaleSgdCents),
    );
  });

  it("with no discount, discountedSale equals sale (unchanged behaviour)", () => {
    const win = {
      widthCm: 280,
      dayPrice: SIGNATURE,
      nightPrice: null,
      addSFold: true,
      addSlimTracks: false,
    };
    const q = computeQuote([win], BOOK, ASSUMPTIONS);
    expect(q.discountedSaleSgdCents).toBe(q.saleSgdCents);
    expect(q.marginBps).toBe(marginBps(q.netCostSgdCents, q.saleSgdCents));
  });

  it("returns zeros for an empty order", () => {
    const q = computeQuote([], BOOK, ASSUMPTIONS);
    expect(q.cogsRmbCents).toBe(0);
    expect(q.saleSgdCents).toBe(0);
    expect(q.marginBps).toBe(0);
  });

  it("uses a flat sea freight when shipping by sea", () => {
    const win = {
      widthCm: 280,
      dayPrice: SIGNATURE,
      nightPrice: null,
      addSFold: true,
      addSlimTracks: false,
    };
    const air = computeQuote([win], BOOK, ASSUMPTIONS, "air");
    const sea = computeQuote([win], BOOK, ASSUMPTIONS, "sea");
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

describe("windowQuote — blinds", () => {
  it("prices by width with NO style multiplier on cost", () => {
    const q = windowQuote(
      { widthCm: 200, blindPrice: BLIND, addSFold: false, addSlimTracks: false },
      BOOK,
      ASSUMPTIONS.styleMultiplier,
    );

    // 2.0m × ¥40 = ¥80. A curtain would be ¥160 here (×2.0 fullness).
    expect(q.costRmbCents).toBe(8000);
    expect(q.saleSgdCents).toBe(14000); // 2.0m × S$70
    expect(q.offering).toBe("blind");
  });

  it("adds no track and no add-ons even when the toggles are set", () => {
    const withToggles = windowQuote(
      { widthCm: 200, blindPrice: BLIND, addSFold: true, addSlimTracks: true },
      BOOK,
      ASSUMPTIONS.styleMultiplier,
    );
    const without = windowQuote(
      { widthCm: 200, blindPrice: BLIND, addSFold: false, addSlimTracks: false },
      BOOK,
      ASSUMPTIONS.styleMultiplier,
    );
    expect(withToggles).toEqual(without);
  });

  it("ignores a combo price — combos are a curtain bundle", () => {
    const q = windowQuote(
      {
        widthCm: 200,
        blindPrice: BLIND,
        addSFold: false,
        addSlimTracks: false,
        comboPriceSgdCents: 999_00,
      },
      BOOK,
      ASSUMPTIONS.styleMultiplier,
    );
    expect(q.saleSgdCents).toBe(14000);
  });

  it("counts blind cost toward the air-freight base", () => {
    const q = windowQuote(
      { widthCm: 200, blindPrice: BLIND, addSFold: false, addSlimTracks: false },
      BOOK,
      ASSUMPTIONS.styleMultiplier,
    );
    expect(q.curtainCostRmbCents).toBe(8000);
  });

  it("is 'none' — and free — when unmeasured", () => {
    const q = windowQuote(
      { widthCm: null, blindPrice: BLIND, addSFold: false, addSlimTracks: false },
      BOOK,
      ASSUMPTIONS.styleMultiplier,
    );
    expect(q.offering).toBe("none");
    expect(q.costRmbCents).toBe(0);
    expect(q.saleSgdCents).toBe(0);
  });

  it("never prices a curtain leg on a blind window", () => {
    // Stale day/night prices left over from a switched window must not add up.
    const q = windowQuote(
      {
        widthCm: 200,
        blindPrice: BLIND,
        dayPrice: SIGNATURE,
        nightPrice: SIGNATURE,
        addSFold: false,
        addSlimTracks: false,
      },
      BOOK,
      ASSUMPTIONS.styleMultiplier,
    );
    expect(q.saleSgdCents).toBe(14000);
    expect(q.costRmbCents).toBe(8000);
  });
});

describe("installation cost by offering", () => {
  const measure = (win: Parameters<typeof computeQuote>[0][number]) =>
    computeQuote([win], BOOK, ASSUMPTIONS, "sea", 0, 0).installationSgdCents;

  it("charges the blinds rate for a blind window", () => {
    expect(
      measure({
        widthCm: 200,
        blindPrice: BLIND,
        addSFold: false,
        addSlimTracks: false,
      }),
    ).toBe(ASSUMPTIONS.handymanBlindsSgdCents);
  });

  it("still charges single and double rates for curtains", () => {
    expect(
      measure({
        widthCm: 200,
        dayPrice: SIGNATURE,
        addSFold: false,
        addSlimTracks: false,
      }),
    ).toBe(ASSUMPTIONS.handymanSingleSgdCents);
    expect(
      measure({
        widthCm: 200,
        dayPrice: SIGNATURE,
        nightPrice: SIGNATURE,
        addSFold: false,
        addSlimTracks: false,
      }),
    ).toBe(ASSUMPTIONS.handymanDoubleSgdCents);
  });

  it("charges nothing for an unmeasured blind", () => {
    expect(
      measure({
        widthCm: null,
        blindPrice: BLIND,
        addSFold: false,
        addSlimTracks: false,
      }),
    ).toBe(0);
  });

  it("charges both rates on a mixed curtain + blind order", () => {
    const total = computeQuote(
      [
        { widthCm: 200, dayPrice: SIGNATURE, nightPrice: SIGNATURE, addSFold: false, addSlimTracks: false },
        { widthCm: 200, blindPrice: BLIND, addSFold: false, addSlimTracks: false },
      ],
      BOOK,
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
