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
  handymanSgdCents: 10000, // S$100
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
    // single track cost 2500, sale 3500; curtain-only cost = day 28560
    expect(q).toEqual({
      costRmbCents: 34140,
      saleSgdCents: 51100,
      curtainCostRmbCents: 28560,
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
    // double track cost 2500, sale 4000; curtain-only cost = 61200
    expect(q).toEqual({
      costRmbCents: 63700,
      saleSgdCents: 58000,
      curtainCostRmbCents: 61200,
    });
  });

  it("is zero for an unmeasured / unpriced window", () => {
    expect(
      windowQuote(
        { widthCm: null, addSFold: true, addSlimTracks: true },
        BOOK,
        ASSUMPTIONS.styleMultiplier,
      ),
    ).toEqual({ costRmbCents: 0, saleSgdCents: 0, curtainCostRmbCents: 0 });
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
    expect(q.saleSgdCents).toBe(51100);
    expect(q.freightRmbCents).toBe(50000); // clamped to the ¥500 floor
    expect(q.otherCostRmbCents).toBe(3414);
    expect(q.gstRmbCents).toBe(3073);
    expect(q.grossCostRmbCents).toBe(90627);
    expect(q.grossCostSgdCents).toBe(17099);
    expect(q.netCostSgdCents).toBe(27099);
    expect(q.marginBps).toBe(4697); // 46.97%
    expect(q.groupbuySgdCents).toBe(43435);
    expect(q.groupbuyMarginBps).toBe(3761); // 37.61%
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
