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
  /**
   * The series this price came from ("Essential", "Signature", …), carried so
   * the cost breakdown can say what a window is made of. Never read by the
   * arithmetic — a missing name costs a label, not a price.
   */
  label?: string | null;
};

// ── the cost breakdown ───────────────────────────────────────────────────
//
// COGS shown the way the order was captured: room by room, window by window. A
// single lump says the order costs ¥723; this says which window is carrying it.
// Labels come from the caller — pricing never invents them — and no arithmetic
// reads any of this.
//
// Both product lines share these types because `finaliseQuote` is shared: it
// passes the tree through without knowing which engine built it.

/** One measured thing — a window, or a mesh panel — and what it cost us. */
export type CogsItem = {
  /** "Window 1", "Panel 2". */
  label: string;
  /** What it's made of: the series name(s), or the mesh category. */
  detail: string | null;
  rmbCents: number;
};

/** One room, its subtotal, and the items under it. */
export type CogsRoom = {
  label: string;
  rmbCents: number;
  items: CogsItem[];
};

/**
 * An order-level cost line that belongs to no single window — today, the rails.
 *
 * A rail is hardware we buy per window and never bill, so burying it inside a
 * window's figure makes that figure look like the fabric price and isn't. It is
 * pulled out and counted instead: one line per kind of rail, with how many.
 */
export type CogsExtra = {
  /** "Track (single)". */
  label: string;
  /** How many windows contributed one. */
  count: number;
  rmbCents: number;
};

/**
 * Where a line item sits, for the breakdown alone. `roomIndex` does the
 * grouping rather than the label, so two rooms both called "Bedroom" stay two
 * rooms.
 */
export type BreakdownIdentity = {
  roomIndex?: number;
  roomLabel?: string | null;
  /** Supplied when the caller knows it (mesh); curtains derive it per window. */
  itemDetail?: string | null;
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

export type CalcWindow = BreakdownIdentity & {
  widthCm: number | null;
  /**
   * Manufacturing width, when a set has been confirmed (Phase 13B). Cost only —
   * the sale side always uses widthCm, which is what the customer was quoted on.
   */
  costWidthCm?: number | null;
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

type Money = { costRmbCents: number; saleSgdCents: number };

const ZERO: Money = { costRmbCents: 0, saleSgdCents: 0 };
const add = (a: Money, b: Money): Money => ({
  costRmbCents: a.costRmbCents + b.costRmbCents,
  saleSgdCents: a.saleSgdCents + b.saleSgdCents,
});

/**
 * The width the COST side prices on: what the vendor is actually cutting once a
 * manufacturing set has been confirmed, and the measured width until then.
 *
 * A missing or nonsensical manufacturing width falls back to the measured one
 * rather than zeroing the cost — a zero COGS reports a ~100% margin, which is a
 * far more dangerous wrong answer than a slightly generous one. The zero-guards
 * below therefore stay keyed on the measured width alone: an unmeasured window
 * is free on both sides, whatever any manufacturing row says.
 */
function costWidthOf(
  widthCm: number,
  costWidthCm: number | null | undefined,
): number {
  return costWidthCm != null && costWidthCm > 0 ? costWidthCm : widthCm;
}

// A curtain (day or night) priced by width. Cost applies the style multiplier
// (more fabric); the sale rate already includes fullness so it doesn't.
function curtainLeg(
  price: SeriesPrice | null | undefined,
  widthCm: number | null,
  costWidthCm: number | null | undefined,
  styleMultiplier: number,
): Money {
  if (!price || widthCm == null || widthCm <= 0) return ZERO;
  const widthM = widthCm / 100;
  const costWidthM = costWidthOf(widthCm, costWidthCm) / 100;
  const mult = styleMultiplier / 10000;
  return {
    costRmbCents: Math.round(costWidthM * mult * (price.costRmbCents ?? 0)),
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
  costWidthCm: number | null | undefined,
): Money {
  if (!price || widthCm == null || widthCm <= 0) return ZERO;
  const widthM = widthCm / 100;
  const costWidthM = costWidthOf(widthCm, costWidthCm) / 100;
  return {
    costRmbCents: Math.round(costWidthM * (price.costRmbCents ?? 0)),
    saleSgdCents: Math.round(widthM * (price.saleSgdCents ?? 0)),
  };
}

// An add-on: per-metre scales by width, per-unit is a flat charge.
function addonLeg(
  addon: AddonPrice | null | undefined,
  widthCm: number | null,
  costWidthCm?: number | null,
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
  const costWidthM = costWidthOf(widthCm, costWidthCm) / 100;
  return {
    costRmbCents: Math.round(costWidthM * (addon.costRmbCents ?? 0)),
    saleSgdCents: Math.round(widthM * (addon.saleSgdCents ?? 0)),
  };
}

/**
 * What a window is made of, for its breakdown row: the series behind each leg.
 * Day + night from two different series reads "Essential + Signature"; from one
 * series, once. A blind says so — it is priced by different rules.
 */
export function windowDetail(win: CalcWindow): string | null {
  if (win.blindPrice) {
    return win.blindPrice.label ? `${win.blindPrice.label} (blind)` : null;
  }
  const named = [win.dayPrice?.label, win.nightPrice?.label].filter(
    (n): n is string => !!n,
  );
  const unique = [...new Set(named)];
  return unique.length > 0 ? unique.join(" + ") : null;
}

type BreakdownInput = BreakdownIdentity & {
  detail: string | null;
  rmbCents: number;
};

/**
 * Build the room tree from a flat list of priced items, in the order they were
 * given — which is the order the consultant entered them, so the breakdown
 * reads down the form.
 *
 * Items are numbered within their room ("Window 1", "Window 2"), not across the
 * order: the numbering matches what the room's own card shows.
 */
export function groupIntoRooms(
  items: BreakdownInput[],
  itemNoun: string,
): CogsRoom[] {
  const rooms = new Map<string, CogsRoom>();

  for (const item of items) {
    // Group on the index; fall back to the label only when there is no index
    // (unit tests, mostly) so identically-named rooms don't merge.
    const key = String(item.roomIndex ?? item.roomLabel ?? "");
    let room = rooms.get(key);
    if (!room) {
      room = {
        label:
          item.roomLabel ||
          (item.roomIndex != null ? `Room ${item.roomIndex + 1}` : "Order"),
        rmbCents: 0,
        items: [],
      };
      rooms.set(key, room);
    }
    room.items.push({
      label: `${itemNoun} ${room.items.length + 1}`,
      detail: item.detail,
      rmbCents: item.rmbCents,
    });
    room.rmbCents += item.rmbCents;
  }

  return [...rooms.values()];
}

/**
 * The order's rails as one line per kind: "Track (single) × 4".
 *
 * Counted, not listed per window, because that is how they are bought — four
 * windows needing a rail is one order of four rails. Singles and doubles stay
 * apart: they are different hardware at different prices.
 */
function countTracks(
  tracks: { kind: TrackKind; rmbCents: number }[],
): CogsExtra[] {
  const byKind = new Map<TrackKind, CogsExtra>();
  for (const t of tracks) {
    const existing = byKind.get(t.kind);
    if (existing) {
      existing.count += 1;
      existing.rmbCents += t.rmbCents;
    } else {
      byKind.set(t.kind, {
        label: `Track (${t.kind})`,
        count: 1,
        rmbCents: t.rmbCents,
      });
    }
  }
  // Single before double, so a mixed order always reads the same way round.
  return (["single", "double"] as const)
    .map((k) => byKind.get(k))
    .filter((e): e is CogsExtra => !!e);
}

export type Offering = "none" | "single" | "double" | "blind";

/** Which rail a window carries, if any — one line per kind in the breakdown. */
export type TrackKind = "single" | "double";

export function windowQuote(
  win: CalcWindow,
  book: CalcAddonBook,
  styleMultiplier: number,
): Money & {
  curtainCostRmbCents: number;
  offering: Offering;
  /**
   * The rail's cost, already included in `costRmbCents`. Reported separately so
   * the breakdown can lift it out of the window's figure and count it with the
   * other rails — it is hardware we buy, not part of what the window is.
   */
  trackRmbCents: number;
  trackKind: TrackKind | null;
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
    const leg = blindLeg(win.blindPrice, win.widthCm, win.costWidthCm);
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
      // A blind carries its own headrail — there is no separate track to buy.
      trackRmbCents: 0,
      trackKind: null,
    };
  }

  const hasDay = !!win.dayPrice && win.widthCm != null && win.widthCm > 0;
  const hasNight = !!win.nightPrice && win.widthCm != null && win.widthCm > 0;

  const dayLeg = curtainLeg(
    win.dayPrice,
    win.widthCm,
    win.costWidthCm,
    styleMultiplier,
  );
  const nightLeg = curtainLeg(
    win.nightPrice,
    win.widthCm,
    win.costWidthCm,
    styleMultiplier,
  );

  let total: Money = add(add(ZERO, dayLeg), nightLeg);
  if (win.addSFold)
    total = add(total, addonLeg(book.sFold, win.widthCm, win.costWidthCm));
  if (win.addSlimTracks)
    total = add(total, addonLeg(book.slimTracks, win.widthCm, win.costWidthCm));

  // Track: double if both day + night, single if just one. The rail is a cost
  // we bear, not a customer line item (unlike the opt-in add-ons above) — so
  // only its COST feeds COGS; its notional sale price is kept out of the quote.
  const trackKind: TrackKind | null =
    hasDay && hasNight ? "double" : hasDay || hasNight ? "single" : null;
  const trackRmbCents =
    trackKind === "double"
      ? addonLeg(book.doubleTrack, null).costRmbCents
      : trackKind === "single"
        ? addonLeg(book.singleTrack, null).costRmbCents
        : 0;
  total = add(total, { costRmbCents: trackRmbCents, saleSgdCents: 0 });

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
    trackRmbCents,
    trackKind,
  };
}

export type QuoteResult = {
  cogsRmbCents: number;
  /**
   * COGS broken out room by room. Together with `cogsExtras` the subtotals sum
   * to `cogsRmbCents` exactly.
   */
  cogsRooms: CogsRoom[];
  /** Order-level lines that belong to no one window — the rails. */
  cogsExtras: CogsExtra[];
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
   * The same COGS, room by room. Passed through untouched — freight, other cost
   * and GST are all charged on the total and never on a single room.
   */
  cogsRooms: CogsRoom[];
  cogsExtras: CogsExtra[];
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
  //
  // Note for anyone asking why a confirmed order's MARGIN improved with no
  // price change: freightBaseRmbCents follows COGS, and COGS follows the
  // manufacturing width once a set is confirmed (see costWidthCm). Smaller
  // piece → lower cost → lower freight → higher margin. That is intended.
  // Only the SALE is frozen; the cost side is meant to track what is actually
  // being made, and reporting the pre-allowance cost would overstate spend.
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
    cogsRooms: totals.cogsRooms,
    cogsExtras: totals.cogsExtras,
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
        // The window's own cost — fabric and its add-ons — with the rail taken
        // out. The rails are counted below and listed once; between the two,
        // every cent still lands somewhere.
        breakdown: [
          ...acc.breakdown,
          {
            ...w,
            detail: windowDetail(w),
            rmbCents: q.costRmbCents - q.trackRmbCents,
          },
        ],
        tracks: q.trackKind
          ? [...acc.tracks, { kind: q.trackKind, rmbCents: q.trackRmbCents }]
          : acc.tracks,
      };
    },
    {
      costRmbCents: 0,
      saleSgdCents: 0,
      curtainCostRmbCents: 0,
      installSgdCents: 0,
      breakdown: [] as BreakdownInput[],
      tracks: [] as { kind: TrackKind; rmbCents: number }[],
    },
  );

  // Curtains bill air freight on curtain-only COGS — add-ons and tracks are
  // excluded, per the Excel's sum(Day COGS, Night COGS) × rate.
  return finaliseQuote(
    {
      cogsRmbCents: totals.costRmbCents,
      cogsRooms: groupIntoRooms(totals.breakdown, "Window"),
      cogsExtras: countTracks(totals.tracks),
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
