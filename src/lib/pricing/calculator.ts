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

export type FreightMode = "air" | "sea";

export type CalcAssumptions = {
  fxSgdToRmb: number; // ×10000, e.g. 53000 = 5.3
  gstBps: number;
  otherCostBps: number;
  groupbuyDiscountBps: number;
  styleMultiplier: number; // ×10000, e.g. 20000 = 2.0
  // Installation cost per window, by offering.
  handymanSingleSgdCents: number; // single curtain (1 track)
  handymanDoubleSgdCents: number; // double curtain (day + night)
  handymanBlindsSgdCents: number; // blinds
  seaFreightRmbCentsPerM3: number; // flat charge when shipping by sea
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
  // Phase 12 — a blind occupies the window INSTEAD of curtains, so this is
  // mutually exclusive with day/night. Priced per metre of width like a
  // curtain, but with no style multiplier, no add-ons and no track.
  blindPrice?: SeriesPrice | null;
  addSFold: boolean;
  addSlimTracks: boolean;
  // Phase 10 — a picked combo fixes this window's sale to a bundle price,
  // overriding the per-metre day/night sale. Cost is left untouched.
  comboPriceSgdCents?: number | null;
};

// COGS is a sum of distinct things — fabric, each add-on, the rail — and the
// cost breakdown shows them one per line rather than as a single lump. Carried
// as a key, never a label, so pricing stays free of presentation; the UI maps
// key → label (see `cogs-labels.ts`).
//
// The keys of both product lines live together because `finaliseQuote` is
// shared: it passes the lines through without knowing which engine built them.
export type CogsKey =
  // curtains
  | "curtains"
  | "blinds"
  | "s_fold"
  | "slim_tracks"
  | "track"
  // mesh
  | "mesh"
  | "colour"
  | "double_draw";

export type CogsLine = { key: CogsKey; rmbCents: number };

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

// A blind, priced by width like a curtain but WITHOUT the style multiplier:
// the multiplier buys extra fabric for gathering, and a blind hangs flat.
//
// NOTE: the Excel prices blinds by area (height x width). Per-width is a
// deliberate product decision -- see docs/specs/phase-12 §2.1 -- with the known
// consequence that height does not affect the price.
function blindLeg(
  price: SeriesPrice | null | undefined,
  widthCm: number | null,
): Money {
  if (!price || widthCm == null || widthCm <= 0) return ZERO;
  const widthM = widthCm / 100;
  return {
    costRmbCents: Math.round(widthM * (price.costRmbCents ?? 0)),
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

export type Offering = "none" | "single" | "double" | "blind";

/** This window's COGS, itemised. The five always sum to `costRmbCents`. */
export type WindowCogs = {
  curtains: number;
  blinds: number;
  sFold: number;
  slimTracks: number;
  track: number;
};

const ZERO_COGS: WindowCogs = {
  curtains: 0,
  blinds: 0,
  sFold: 0,
  slimTracks: 0,
  track: 0,
};

export const addCogs = (a: WindowCogs, b: WindowCogs): WindowCogs => ({
  curtains: a.curtains + b.curtains,
  blinds: a.blinds + b.blinds,
  sFold: a.sFold + b.sFold,
  slimTracks: a.slimTracks + b.slimTracks,
  track: a.track + b.track,
});

export function windowQuote(
  win: CalcWindow,
  book: CalcAddonBook,
  styleMultiplier: number,
): Money & {
  curtainCostRmbCents: number;
  offering: Offering;
  cogs: WindowCogs;
} {
  // A blind window is priced and installed on its own terms: per metre of
  // width, with NO style multiplier (that models gathered fabric fullness, and
  // a blind doesn't gather), no S-Fold/Slim-Tracks (curtain hardware) and no
  // track (a blind carries its own headrail). Its cost still joins the
  // air-freight base, which is why it is returned as curtainCostRmbCents.
  //
  // Returned before the curtain path so a stale add-on flag left on the form
  // mid-switch can't add a charge to a blind.
  if (win.blindPrice) {
    const leg = blindLeg(win.blindPrice, win.widthCm);
    const measured = win.widthCm != null && win.widthCm > 0;
    // A combo is a curtain bundle (day + night + track at a fixed price) and is
    // deliberately NOT honoured here — comboPriceSgdCents is ignored rather
    // than applied, so a combo left over from a switched-back window can't
    // override a blind's price.
    return {
      costRmbCents: leg.costRmbCents,
      saleSgdCents: leg.saleSgdCents,
      curtainCostRmbCents: leg.costRmbCents,
      offering: measured ? "blind" : "none",
      cogs: { ...ZERO_COGS, blinds: leg.costRmbCents },
    };
  }

  const hasDay = !!win.dayPrice && win.widthCm != null && win.widthCm > 0;
  const hasNight = !!win.nightPrice && win.widthCm != null && win.widthCm > 0;

  const dayLeg = curtainLeg(win.dayPrice, win.widthCm, styleMultiplier);
  const nightLeg = curtainLeg(win.nightPrice, win.widthCm, styleMultiplier);

  const sFoldLeg = win.addSFold ? addonLeg(book.sFold, win.widthCm) : ZERO;
  const slimLeg = win.addSlimTracks
    ? addonLeg(book.slimTracks, win.widthCm)
    : ZERO;

  // Track: double if both day + night, single if just one. The rail is a cost
  // we bear, not a customer line item (unlike the opt-in add-ons above) — so
  // only its COST feeds COGS; its notional sale price is kept out of the quote.
  const trackCost = (m: Money): Money => ({
    costRmbCents: m.costRmbCents,
    saleSgdCents: 0,
  });
  const trackLeg = trackCost(
    hasDay && hasNight
      ? addonLeg(book.doubleTrack, null)
      : hasDay || hasNight
        ? addonLeg(book.singleTrack, null)
        : ZERO,
  );

  const total: Money = [dayLeg, nightLeg, sFoldLeg, slimLeg, trackLeg].reduce(
    add,
    ZERO,
  );

  // Offering drives the per-window installation cost.
  const offering: Offering =
    hasDay && hasNight ? "double" : hasDay || hasNight ? "single" : "none";

  // Combo (Phase 10): a fixed bundle price overrides the window's sale. Cost
  // (curtain COGS + add-ons + track) is unchanged, so the margin stays genuine.
  const saleSgdCents =
    win.comboPriceSgdCents != null ? win.comboPriceSgdCents : total.saleSgdCents;

  // Curtain-only COGS (excludes add-ons/tracks) — the air-freight base, per the
  // Excel's sum(Day COGS, Night COGS) × rate.
  return {
    costRmbCents: total.costRmbCents,
    saleSgdCents,
    curtainCostRmbCents: dayLeg.costRmbCents + nightLeg.costRmbCents,
    offering,
    cogs: {
      curtains: dayLeg.costRmbCents + nightLeg.costRmbCents,
      blinds: 0,
      sFold: sFoldLeg.costRmbCents,
      slimTracks: slimLeg.costRmbCents,
      track: trackLeg.costRmbCents,
    },
  };
}

export type QuoteResult = {
  cogsRmbCents: number;
  /** What `cogsRmbCents` is made of. Sums to it exactly; may contain zero rows. */
  cogsLines: CogsLine[];
  freightRmbCents: number;
  otherCostRmbCents: number;
  gstRmbCents: number;
  grossCostRmbCents: number;
  grossCostSgdCents: number;
  installationSgdCents: number; // per-offering install + ad-hoc extra
  netCostSgdCents: number;
  saleSgdCents: number; // pre-discount sum of window sales
  discountedSaleSgdCents: number; // after the order-level promotion discount
  marginBps: number; // 1 − netCost/discountedSale, ×10000
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

const installFor = (offering: Offering, a: CalcAssumptions): number =>
  offering === "blind"
    ? a.handymanBlindsSgdCents
    : offering === "double"
      ? a.handymanDoubleSgdCents
      : offering === "single"
        ? a.handymanSingleSgdCents
        : 0;

// The half of the quote that every product line shares: freight, other cost,
// GST, RMB→SGD, installation, the order-level discount, margin and groupbuy.
// Product-specific code only has to reduce its line items down to these four
// numbers and hand them over.
//
// `freightBaseRmbCents` is separate from `cogsRmbCents` because the two are not
// the same for curtains: air freight is billed on curtain-only COGS, excluding
// add-ons and tracks, per the Excel sheet.
export type QuoteTotals = {
  cogsRmbCents: number;
  /**
   * The itemised COGS. Product-specific — each engine names its own components
   * — and passed through untouched, since freight/other/GST are computed on the
   * total and never on a single line.
   */
  cogsLines: CogsLine[];
  freightBaseRmbCents: number;
  saleSgdCents: number;
  installSgdCents: number;
};

export function finaliseQuote(
  totals: QuoteTotals,
  a: CalcAssumptions,
  freightMode: FreightMode = "air",
  extraInstallSgdCents = 0,
  discountBps = 0,
): QuoteResult {
  const cogs = totals.cogsRmbCents;
  const sale = totals.saleSgdCents;

  // Air = rate × curtain COGS, clamped. Sea = flat per-m³ charge.
  const freight =
    freightMode === "sea"
      ? a.seaFreightRmbCentsPerM3
      : clamp(
          Math.round((totals.freightBaseRmbCents * a.airFreightRateBps) / 10000),
          a.airFreightFloorRmbCents,
          a.airFreightCapRmbCents,
        );
  const other = Math.round((cogs * a.otherCostBps) / 10000);
  const gst = Math.round((cogs * a.gstBps) / 10000);
  const grossCostRmb = cogs + freight + other + gst;
  // RMB → SGD: cents / (fx/10000) = cents × 10000 / fx.
  const grossCostSgd = Math.round((grossCostRmb * 10000) / a.fxSgdToRmb);
  const installation = totals.installSgdCents + extraInstallSgdCents;
  const netCostSgd = grossCostSgd + installation;

  // Order-level promotion (Phase 10): discount the summed sale. Margin +
  // groupbuy track the discounted price. discountBps=0 leaves everything as-is.
  const discountedSale = Math.round((sale * (10000 - discountBps)) / 10000);

  const groupbuy = Math.round(
    (discountedSale * (10000 - a.groupbuyDiscountBps)) / 10000,
  );

  return {
    cogsRmbCents: cogs,
    cogsLines: totals.cogsLines,
    freightRmbCents: freight,
    otherCostRmbCents: other,
    gstRmbCents: gst,
    grossCostRmbCents: grossCostRmb,
    grossCostSgdCents: grossCostSgd,
    installationSgdCents: installation,
    netCostSgdCents: netCostSgd,
    saleSgdCents: sale,
    discountedSaleSgdCents: discountedSale,
    marginBps: marginBps(netCostSgd, discountedSale),
    groupbuySgdCents: groupbuy,
    groupbuyMarginBps: marginBps(netCostSgd, groupbuy),
  };
}

export function computeQuote(
  windows: CalcWindow[],
  book: CalcAddonBook,
  a: CalcAssumptions,
  freightMode: FreightMode = "air",
  extraInstallSgdCents = 0,
  discountBps = 0,
): QuoteResult {
  const totals = windows.reduce(
    (acc, w) => {
      const q = windowQuote(w, book, a.styleMultiplier);
      return {
        costRmbCents: acc.costRmbCents + q.costRmbCents,
        saleSgdCents: acc.saleSgdCents + q.saleSgdCents,
        curtainCostRmbCents: acc.curtainCostRmbCents + q.curtainCostRmbCents,
        installSgdCents: acc.installSgdCents + installFor(q.offering, a),
        cogs: addCogs(acc.cogs, q.cogs),
      };
    },
    {
      costRmbCents: 0,
      saleSgdCents: 0,
      curtainCostRmbCents: 0,
      installSgdCents: 0,
      cogs: ZERO_COGS,
    },
  );

  // Curtains bill air freight on curtain-only COGS — add-ons and tracks are
  // excluded, per the Excel's sum(Day COGS, Night COGS) × rate.
  return finaliseQuote(
    {
      cogsRmbCents: totals.costRmbCents,
      cogsLines: [
        { key: "curtains", rmbCents: totals.cogs.curtains },
        { key: "blinds", rmbCents: totals.cogs.blinds },
        { key: "s_fold", rmbCents: totals.cogs.sFold },
        { key: "slim_tracks", rmbCents: totals.cogs.slimTracks },
        { key: "track", rmbCents: totals.cogs.track },
      ],
      freightBaseRmbCents: totals.curtainCostRmbCents,
      saleSgdCents: totals.saleSgdCents,
      installSgdCents: totals.installSgdCents,
    },
    a,
    freightMode,
    extraInstallSgdCents,
    discountBps,
  );
}
