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
  trackCostRmbCentsPerM: 2500, // ¥25 per metre of MEASURED width
};

const BOOK: CalcAddonBook = {
  sFold: { costRmbCents: 1100, saleSgdCents: 8000, basis: "per_metre" },
  slimTracks: { costRmbCents: 3500, saleSgdCents: 5000, basis: "per_metre" },
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
        addSFold: false,
        addSlimTracks: false,
      },
      BOOK,
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
        addSFold: false,
        addSlimTracks: false,
      },
      BOOK,
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
      addSFold: false,
      addSlimTracks: false,
    };
    const plain = windowQuote(base, BOOK, ASSUMPTIONS);
    const combo = windowQuote(
      { ...base, comboPriceSgdCents: 45000 }, // S$450 bundle
      BOOK,
      ASSUMPTIONS,
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
      addSFold: false,
      addSlimTracks: false,
    });
    const q = computeQuote(
      [win(0), win(1), win(2), win(3)],
      BOOK,
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
      addSFold: false,
      addSlimTracks: false,
    };
    const double = { ...single, nightPrice: NIGHT };
    const q = computeQuote([single, double, double], BOOK, ASSUMPTIONS);
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
      ASSUMPTIONS,
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
      ASSUMPTIONS,
    );
    const without = windowQuote(
      { widthCm: 200, blindPrice: BLIND, addSFold: false, addSlimTracks: false },
      BOOK,
      ASSUMPTIONS,
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
      ASSUMPTIONS,
    );
    expect(q.saleSgdCents).toBe(14000);
  });

  it("counts blind cost toward the air-freight base", () => {
    const q = windowQuote(
      { widthCm: 200, blindPrice: BLIND, addSFold: false, addSlimTracks: false },
      BOOK,
      ASSUMPTIONS,
    );
    expect(q.curtainCostRmbCents).toBe(8000);
  });

  it("is 'none' — and free — when unmeasured", () => {
    const q = windowQuote(
      { widthCm: null, blindPrice: BLIND, addSFold: false, addSlimTracks: false },
      BOOK,
      ASSUMPTIONS,
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
  const base = {
    widthCm: 300,
    dayPrice: SIGNATURE,
    addSFold: false,
    addSlimTracks: false,
  };

  it("lowers the cost and leaves the sale exactly where it was", () => {
    const measured = windowQuote(base, BOOK, ASSUMPTIONS);
    const made = windowQuote(
      { ...base, costWidthCm: 298 },
      BOOK,
      ASSUMPTIONS,
    );

    // 2.98m × 2.0 × ¥51 = ¥303.96, against ¥306.00 on the measured 3.00m.
    expect(made.curtainCostRmbCents).toBe(30396);
    expect(measured.curtainCostRmbCents).toBe(30600);
    expect(made.costRmbCents).toBeLessThan(measured.costRmbCents);
    // The customer's number does not move.
    expect(made.saleSgdCents).toBe(measured.saleSgdCents);
    expect(made.saleSgdCents).toBe(27000);
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
      addSFold: true,
      addSlimTracks: false,
    };
    // Omitted (no confirmed set) and explicitly null (a row that never arrived)
    // must both behave as they did before the field existed.
    expect(windowQuote(win, BOOK, ASSUMPTIONS)).toEqual(today);
    expect(
      windowQuote(
        { ...win, costWidthCm: null },
        BOOK,
        ASSUMPTIONS,
      ),
    ).toEqual(today);
  });

  it("applies to the night leg as well as the day leg", () => {
    const q = windowQuote(
      { ...base, nightPrice: SIGNATURE, costWidthCm: 298 },
      BOOK,
      ASSUMPTIONS,
    );
    // Both legs cut at 2.98m: 2 × ¥303.96.
    expect(q.curtainCostRmbCents).toBe(2 * 30396);
    expect(q.saleSgdCents).toBe(54000); // 2 × 3.00m × S$90
  });

  it("applies to the blind leg", () => {
    const made = windowQuote(
      {
        widthCm: 200,
        costWidthCm: 198,
        blindPrice: BLIND,
        addSFold: false,
        addSlimTracks: false,
      },
      BOOK,
      ASSUMPTIONS,
    );
    expect(made.costRmbCents).toBe(7920); // 1.98m × ¥40
    expect(made.saleSgdCents).toBe(14000); // still 2.00m × S$70
  });

  it("costs per-metre add-ons on the manufacturing width, sells them on the measured one", () => {
    const win = {
      widthCm: 280,
      dayPrice: SIGNATURE,
      addSFold: true,
      addSlimTracks: true,
    };
    const made = windowQuote(
      { ...win, costWidthCm: 278 },
      BOOK,
      ASSUMPTIONS,
    );
    const measured = windowQuote(win, BOOK, ASSUMPTIONS);

    // fabric 2.78×2×5100=28356, s-fold 2.78×1100=3058,
    // slim tracks 2.78×3500=9730. The rail bills on the MEASURED 2.80m either
    // way — it is cut to the opening, not to the panel — so it is 7000 in both.
    expect(made.costRmbCents).toBe(28356 + 3058 + 9730 + 7000);
    expect(measured.costRmbCents).toBe(28560 + 3080 + 9800 + 7000);
    // Sale: fabric 25200 + s-fold 22400 + slim tracks 14000, both times.
    expect(made.saleSgdCents).toBe(61600);
    expect(measured.saleSgdCents).toBe(61600);
  });

  it("leaves a per-unit add-on flat whatever either width says", () => {
    const perUnit: CalcAddonBook = {
      ...BOOK,
      sFold: { costRmbCents: 1100, saleSgdCents: 8000, basis: "per_unit" },
    };
    const win = { ...base, costWidthCm: 150 }; // an absurd gap, to make a scaling bug loud
    const off = windowQuote(win, perUnit, ASSUMPTIONS);
    const on = windowQuote(
      { ...win, addSFold: true },
      perUnit,
      ASSUMPTIONS,
    );
    expect(on.costRmbCents - off.costRmbCents).toBe(1100);
    expect(on.saleSgdCents - off.saleSgdCents).toBe(8000);
    // The rail bills on the measured 3.00m, so the absurd manufacturing width
    // does not move it: 3.0 × ¥25.
    expect(on.trackRmbCents).toBe(7500);
  });

  it("still lets a combo fix the sale while cost follows the manufacturing width", () => {
    const q = windowQuote(
      {
        ...base,
        nightPrice: SIGNATURE,
        costWidthCm: 298,
        comboPriceSgdCents: 45000,
      },
      BOOK,
      ASSUMPTIONS,
    );
    expect(q.saleSgdCents).toBe(45000);
    expect(q.curtainCostRmbCents).toBe(2 * 30396);
  });

  it("still applies the style multiplier to cost only", () => {
    const win = { ...base, costWidthCm: 298 };
    const double = windowQuote(win, BOOK, {
      ...ASSUMPTIONS,
      styleMultiplier: 20000,
    });
    const triple = windowQuote(win, BOOK, {
      ...ASSUMPTIONS,
      styleMultiplier: 30000,
    });
    expect(double.curtainCostRmbCents).toBe(30396); // 2.98 × 2.0 × 5100
    expect(triple.curtainCostRmbCents).toBe(45594); // 2.98 × 3.0 × 5100
    expect(triple.saleSgdCents).toBe(double.saleSgdCents);
  });

  // The zero-guards still key off the MEASURED width alone. An unmeasured
  // window is free on both sides; a missing or nonsensical manufacturing width
  // falls back to the measured one rather than zeroing COGS, because a zero
  // cost would report a ~100% margin — a far more dangerous wrong answer.
  it("stays free on an unmeasured window even with a manufacturing width", () => {
    expect(
      windowQuote(
        { widthCm: null, costWidthCm: 298, dayPrice: SIGNATURE, addSFold: true, addSlimTracks: true },
        BOOK,
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
    const measured = windowQuote(base, BOOK, ASSUMPTIONS);
    for (const costWidthCm of [0, -5]) {
      expect(
        windowQuote({ ...base, costWidthCm }, BOOK, ASSUMPTIONS),
      ).toEqual(measured);
    }
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
    addSFold: false,
    addSlimTracks: false,
    ...over,
  });

  it("bills a single rail at width × rate", () => {
    // 2.40m × ¥25.
    expect(windowQuote(win(), BOOK, ASSUMPTIONS).trackRmbCents).toBe(6000);
  });

  it("bills a double rail at twice the width, at the SAME rate", () => {
    const single = windowQuote(win(), BOOK, ASSUMPTIONS);
    const double = windowQuote(
      win({ nightPrice: SIGNATURE }),
      BOOK,
      ASSUMPTIONS,
    );
    expect(double.trackKind).toBe("double");
    expect(double.trackRmbCents).toBe(2 * single.trackRmbCents);
  });

  it("follows the width, where the old flat charge did not", () => {
    const narrow = windowQuote(win({ widthCm: 100 }), BOOK, ASSUMPTIONS);
    const wide = windowQuote(win({ widthCm: 300 }), BOOK, ASSUMPTIONS);
    expect(narrow.trackRmbCents).toBe(2500);
    expect(wide.trackRmbCents).toBe(7500);
  });

  it("bills on the measured width, never the manufacturing one", () => {
    const made = windowQuote(
      win({ costWidthCm: 100 }), // an absurd gap, to make a mix-up loud
      BOOK,
      ASSUMPTIONS,
    );
    expect(made.trackRmbCents).toBe(6000); // still 2.40m
  });

  it("is free when the rate is zero, and charges nothing on a blind", () => {
    const free = windowQuote(win(), BOOK, {
      ...ASSUMPTIONS,
      trackCostRmbCentsPerM: 0,
    });
    expect(free.trackRmbCents).toBe(0);
    const blind = windowQuote(
      { widthCm: 240, blindPrice: BLIND, addSFold: false, addSlimTracks: false },
      BOOK,
      ASSUMPTIONS,
    );
    // A blind carries its own headrail.
    expect(blind.trackRmbCents).toBe(0);
  });

  it("stays out of the customer's price whatever the width", () => {
    const narrow = windowQuote(win({ widthCm: 100 }), BOOK, ASSUMPTIONS);
    const wide = windowQuote(win({ widthCm: 100 }), BOOK, {
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
    computeQuote([win], BOOK, ASSUMPTIONS).cogsRooms[0].items[0].legs;

  it("splits a day + night window into its two curtains", () => {
    expect(
      legsOf({
        widthCm: 300,
        dayPrice: ESSENTIAL_L,
        nightPrice: ESSENTIAL_L,
        addSFold: false,
        addSlimTracks: false,
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
        addSFold: false,
        addSlimTracks: false,
      })?.map((l) => l.detail),
    ).toEqual(["Essential", "Signature"]);
  });

  it("lists the add-ons beside the curtains, in charge order", () => {
    expect(
      legsOf({
        widthCm: 280,
        dayPrice: ESSENTIAL_L,
        addSFold: true,
        addSlimTracks: true,
      })?.map((l) => l.label),
    ).toEqual(["Day curtain", "S-Fold", "Slim tracks"]);
  });

  it("has none when the window is a single covering — nothing to break down", () => {
    expect(
      legsOf({
        widthCm: 280,
        dayPrice: ESSENTIAL_L,
        addSFold: false,
        addSlimTracks: false,
      }),
    ).toBeUndefined();
    expect(
      legsOf({
        widthCm: 150,
        blindPrice: { ...SIGNATURE, label: "Korean Combi" },
        addSFold: false,
        addSlimTracks: false,
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
          addSFold: true,
          addSlimTracks: true,
        },
      ],
      BOOK,
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
          addSFold: false,
          addSlimTracks: false,
        },
      ],
      BOOK,
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
      addSFold: false,
      addSlimTracks: false,
    };
    const air = computeQuote([win], BOOK, ASSUMPTIONS, "air");
    const sea = computeQuote([win], BOOK, ASSUMPTIONS, "sea");
    expect(air.freightMode).toBe("air");
    expect(sea.freightMode).toBe("sea");
    expect(air.otherCostBps).toBe(ASSUMPTIONS.otherCostBps);
    expect(air.gstBps).toBe(ASSUMPTIONS.gstBps);
  });
});
