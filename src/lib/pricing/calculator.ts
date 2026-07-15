// Pricing calculator — pure, deterministic port of the Excel "Pricing Output"
// engine. Turns a set of measured windows (with their resolved series prices +
// per-window add-on toggles) into a COGS, a customer sale price, and a margin.
//
// Money is integer cents throughout (RMB cost cents, SGD sale cents). Rates &
// multipliers are integers scaled ×10000 (so ratio 1.0 = 10000), matching the
// pricing_assumptions storage scale.
//
// v1 scope + simplifications (flagged for later refinement):
//  - Curtains priced BY WIDTH: width × style-multiplier × cost/m (cost side);
//    width × sale/m (sale side — fullness is already baked into the sale rate).
//  - Add-ons: S-Fold + Slim tracks (per-metre → × width; per-unit → flat).
//  - Track: single track if one of day/night present, double if both.
//  - Freight: AIR only — clamp(COGS × rate, floor, cap). Sea freight (needs
//    shipping volume) is deferred.
//  - Local freight and the exact installation/handyman floor logic from the
//    sheet are simplified to a flat handyman charge.
//  - Blinds (by SQM) are deferred.

export type CalcAssumptions = {
  fxSgdToRmb: number; // ×10000, e.g. 53000 = 5.3
  gstBps: number;
  otherCostBps: number;
  groupbuyDiscountBps: number;
  styleMultiplier: number; // ×10000, e.g. 20000 = 2.0
  handymanSgdCents: number;
  airFreightRateBps: number;
  airFreightFloorRmbCents: number;
  airFreightCapRmbCents: number;
};

export type SeriesPrice = {
  costRmbCents: number | null;
  saleSgdCents: number | null;
};

export type AddonPrice = {
  costRmbCents: number | null;
  saleSgdCents: number | null;
  basis: "per_metre" | "per_unit";
};

export type CalcAddonBook = {
  sFold?: AddonPrice | null;
  slimTracks?: AddonPrice | null;
  singleTrack?: AddonPrice | null;
  doubleTrack?: AddonPrice | null;
};

export type CalcWindow = {
  widthCm: number | null;
  dayPrice?: SeriesPrice | null;
  nightPrice?: SeriesPrice | null;
  addSFold: boolean;
  addSlimTracks: boolean;
};

type Money = { costRmbCents: number; saleSgdCents: number };

const ZERO: Money = { costRmbCents: 0, saleSgdCents: 0 };
const add = (a: Money, b: Money): Money => ({
  costRmbCents: a.costRmbCents + b.costRmbCents,
  saleSgdCents: a.saleSgdCents + b.saleSgdCents,
});

// A curtain (day or night) priced by width. Cost applies the style multiplier
// (more fabric); the sale rate already includes fullness so it doesn't.
function curtainLeg(
  price: SeriesPrice | null | undefined,
  widthCm: number | null,
  styleMultiplier: number,
): Money {
  if (!price || widthCm == null || widthCm <= 0) return ZERO;
  const widthM = widthCm / 100;
  const mult = styleMultiplier / 10000;
  return {
    costRmbCents: Math.round(widthM * mult * (price.costRmbCents ?? 0)),
    saleSgdCents: Math.round(widthM * (price.saleSgdCents ?? 0)),
  };
}

// An add-on: per-metre scales by width, per-unit is a flat charge.
function addonLeg(
  addon: AddonPrice | null | undefined,
  widthCm: number | null,
): Money {
  if (!addon) return ZERO;
  if (addon.basis === "per_unit") {
    return {
      costRmbCents: addon.costRmbCents ?? 0,
      saleSgdCents: addon.saleSgdCents ?? 0,
    };
  }
  if (widthCm == null || widthCm <= 0) return ZERO;
  const widthM = widthCm / 100;
  return {
    costRmbCents: Math.round(widthM * (addon.costRmbCents ?? 0)),
    saleSgdCents: Math.round(widthM * (addon.saleSgdCents ?? 0)),
  };
}

export function windowQuote(
  win: CalcWindow,
  book: CalcAddonBook,
  styleMultiplier: number,
): Money {
  const hasDay = !!win.dayPrice && win.widthCm != null && win.widthCm > 0;
  const hasNight = !!win.nightPrice && win.widthCm != null && win.widthCm > 0;

  let total: Money = ZERO;
  total = add(total, curtainLeg(win.dayPrice, win.widthCm, styleMultiplier));
  total = add(total, curtainLeg(win.nightPrice, win.widthCm, styleMultiplier));
  if (win.addSFold) total = add(total, addonLeg(book.sFold, win.widthCm));
  if (win.addSlimTracks)
    total = add(total, addonLeg(book.slimTracks, win.widthCm));

  // Track: double if both day + night, single if just one.
  if (hasDay && hasNight) total = add(total, addonLeg(book.doubleTrack, null));
  else if (hasDay || hasNight)
    total = add(total, addonLeg(book.singleTrack, null));

  return total;
}

export type QuoteResult = {
  cogsRmbCents: number;
  freightRmbCents: number;
  otherCostRmbCents: number;
  gstRmbCents: number;
  grossCostRmbCents: number;
  grossCostSgdCents: number;
  handymanSgdCents: number;
  netCostSgdCents: number;
  saleSgdCents: number;
  marginBps: number; // 1 − netCost/sale, ×10000
  groupbuySgdCents: number;
  groupbuyMarginBps: number;
};

const clamp = (n: number, lo: number, hi: number) =>
  Math.min(Math.max(n, lo), hi);

// Margin as basis points: 1 − netCost/sale. 0 when sale is 0.
export function marginBps(netCostSgdCents: number, saleSgdCents: number): number {
  if (saleSgdCents <= 0) return 0;
  return Math.round((1 - netCostSgdCents / saleSgdCents) * 10000);
}

export function computeQuote(
  windows: CalcWindow[],
  book: CalcAddonBook,
  a: CalcAssumptions,
): QuoteResult {
  const totals = windows.reduce(
    (acc, w) => add(acc, windowQuote(w, book, a.styleMultiplier)),
    ZERO,
  );

  const cogs = totals.costRmbCents;
  const sale = totals.saleSgdCents;

  const freight = clamp(
    Math.round((cogs * a.airFreightRateBps) / 10000),
    a.airFreightFloorRmbCents,
    a.airFreightCapRmbCents,
  );
  const other = Math.round((cogs * a.otherCostBps) / 10000);
  const gst = Math.round((cogs * a.gstBps) / 10000);
  const grossCostRmb = cogs + freight + other + gst;
  // RMB → SGD: cents / (fx/10000) = cents × 10000 / fx.
  const grossCostSgd = Math.round((grossCostRmb * 10000) / a.fxSgdToRmb);
  const netCostSgd = grossCostSgd + a.handymanSgdCents;

  const groupbuy = Math.round(
    (sale * (10000 - a.groupbuyDiscountBps)) / 10000,
  );

  return {
    cogsRmbCents: cogs,
    freightRmbCents: freight,
    otherCostRmbCents: other,
    gstRmbCents: gst,
    grossCostRmbCents: grossCostRmb,
    grossCostSgdCents: grossCostSgd,
    handymanSgdCents: a.handymanSgdCents,
    netCostSgdCents: netCostSgd,
    saleSgdCents: sale,
    marginBps: marginBps(netCostSgd, sale),
    groupbuySgdCents: groupbuy,
    groupbuyMarginBps: marginBps(netCostSgd, groupbuy),
  };
}
