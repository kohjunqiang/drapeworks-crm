import "server-only";

import { db } from "@/lib/db/kysely";
import {
  computeQuote,
  type CalcAddonBook,
  type CalcAssumptions,
  type CalcWindow,
  type QuoteResult,
} from "./calculator";
import { quoteStaleness } from "./quote-staleness";

export type OrderQuote = QuoteResult & {
  minMarginBps: number; // for the "below floor?" warning
  discountBps: number; // applied order-level promotion
  promoLabel: string | null; // tier name (null = custom % or none)
  // Staleness of the locked quote vs the current calculation. `baselineCalcCents`
  // is the calc value captured when the quote was locked (null = none captured).
  isStale: boolean;
  baselineCalcCents: number | null;
};

export type CalcConfig = {
  assumptions: CalcAssumptions;
  book: CalcAddonBook;
  minMarginBps: number; // Standard channel floor
  minMarginCarousellBps: number; // Carousell channel floor
};

function assumptionsRowToCalc(r: {
  fx_sgd_to_rmb: number;
  gst_bps: number;
  other_cost_bps: number;
  groupbuy_discount_bps: number;
  style_multiplier: number;
  handyman_single_sgd_cents: number;
  handyman_double_sgd_cents: number;
  handyman_blinds_sgd_cents: number;
  sea_freight_rmb_cents_per_m3: number;
  air_freight_rate_bps: number;
  air_freight_floor_rmb_cents: number;
  air_freight_cap_rmb_cents: number;
}): CalcAssumptions {
  return {
    fxSgdToRmb: r.fx_sgd_to_rmb,
    gstBps: r.gst_bps,
    otherCostBps: r.other_cost_bps,
    groupbuyDiscountBps: r.groupbuy_discount_bps,
    styleMultiplier: r.style_multiplier,
    handymanSingleSgdCents: r.handyman_single_sgd_cents,
    handymanDoubleSgdCents: r.handyman_double_sgd_cents,
    handymanBlindsSgdCents: r.handyman_blinds_sgd_cents,
    seaFreightRmbCentsPerM3: r.sea_freight_rmb_cents_per_m3,
    airFreightRateBps: r.air_freight_rate_bps,
    airFreightFloorRmbCents: r.air_freight_floor_rmb_cents,
    airFreightCapRmbCents: r.air_freight_cap_rmb_cents,
  };
}

// Assumptions + add-on prices for the consultation form's live quote. Plain
// serialisable objects so they cross the server→client boundary as props.
export async function loadCalcConfig(): Promise<CalcConfig | null> {
  const [assumptionsRow, addonRows] = await Promise.all([
    db
      .selectFrom("pricing_assumptions")
      .selectAll()
      .where("singleton", "=", true)
      .executeTakeFirst(),
    db
      .selectFrom("pricing_addons")
      .select(["key", "cost_rmb_cents", "sale_sgd_cents", "basis"])
      .execute(),
  ]);
  if (!assumptionsRow) return null;

  const byKey = new Map(addonRows.map((r) => [r.key, r]));
  const toAddon = (key: string) => {
    const r = byKey.get(key);
    return r
      ? {
          costRmbCents: r.cost_rmb_cents,
          saleSgdCents: r.sale_sgd_cents,
          basis: r.basis,
        }
      : null;
  };

  return {
    assumptions: assumptionsRowToCalc(assumptionsRow),
    book: {
      sFold: toAddon("s_fold"),
      slimTracks: toAddon("slim_tracks"),
      singleTrack: toAddon("single_track"),
      doubleTrack: toAddon("double_track"),
    },
    minMarginBps: assumptionsRow.min_margin_bps,
    minMarginCarousellBps: assumptionsRow.min_margin_carousell_bps,
  };
}

// The window row shape (window measurement/toggles + its resolved day/night/
// toilet series prices + combo price) that both the single-order quote and the
// batched staleness sweep select and map into a `CalcWindow`.
type WindowPriceRow = {
  width_cm: number | null;
  add_s_fold: boolean;
  add_slim_tracks: boolean;
  day_cost: number | null;
  day_sale: number | null;
  night_cost: number | null;
  night_sale: number | null;
  toilet_cost: number | null;
  toilet_sale: number | null;
  combo_price: number | null;
};

function rowToCalcWindow(w: WindowPriceRow): CalcWindow {
  // Toilet windows carry a single curtain via curtain_type_id — price it as
  // the day leg.
  const dayPrice =
    w.day_sale != null || w.day_cost != null
      ? { costRmbCents: w.day_cost, saleSgdCents: w.day_sale }
      : w.toilet_sale != null || w.toilet_cost != null
        ? { costRmbCents: w.toilet_cost, saleSgdCents: w.toilet_sale }
        : null;
  const nightPrice =
    w.night_sale != null || w.night_cost != null
      ? { costRmbCents: w.night_cost, saleSgdCents: w.night_sale }
      : null;
  return {
    widthCm: w.width_cm,
    dayPrice,
    nightPrice,
    addSFold: w.add_s_fold,
    addSlimTracks: w.add_slim_tracks,
    comboPriceSgdCents: w.combo_price,
  };
}

function addonRowsToBook(
  addonRows: {
    key: string;
    cost_rmb_cents: number | null;
    sale_sgd_cents: number | null;
    basis: "per_metre" | "per_unit";
  }[],
): CalcAddonBook {
  const byKey = new Map(addonRows.map((r) => [r.key, r]));
  const toAddon = (key: string): CalcAddonBook[keyof CalcAddonBook] => {
    const r = byKey.get(key);
    if (!r) return null;
    return {
      costRmbCents: r.cost_rmb_cents,
      saleSgdCents: r.sale_sgd_cents,
      basis: r.basis,
    };
  };
  return {
    sFold: toAddon("s_fold"),
    slimTracks: toAddon("slim_tracks"),
    singleTrack: toAddon("single_track"),
    doubleTrack: toAddon("double_track"),
  };
}

// Resolve an order's windows → calculator inputs (each window's day/night
// series price + add-on toggles), pull the assumptions + add-on prices, and
// run the engine. Returns null if there are no priced windows to quote.
export async function computeOrderQuote(
  orderId: string,
): Promise<OrderQuote | null> {
  const [order, windows, assumptionsRow, addonRows] = await Promise.all([
    db
      .selectFrom("orders")
      .select([
        "freight_mode",
        "channel",
        "extra_install_sgd_cents",
        "discount_bps",
        "promo_label",
        "price_calc_at_quote_cents",
      ])
      .where("id", "=", orderId)
      .executeTakeFirst(),
    db
      .selectFrom("windows")
      .innerJoin("rooms", "rooms.id", "windows.room_id")
      .leftJoin("curtain_types as dct", "dct.id", "windows.day_curtain_type_id")
      .leftJoin("curtain_series as dcs", "dcs.id", "dct.series_id")
      .leftJoin(
        "curtain_types as nct",
        "nct.id",
        "windows.night_curtain_type_id",
      )
      .leftJoin("curtain_series as ncs", "ncs.id", "nct.series_id")
      .leftJoin("curtain_types as tct", "tct.id", "windows.curtain_type_id")
      .leftJoin("curtain_series as tcs", "tcs.id", "tct.series_id")
      .leftJoin("pricing_combos as pc", "pc.id", "windows.combo_id")
      .select([
        "windows.width_cm as width_cm",
        "windows.add_s_fold as add_s_fold",
        "windows.add_slim_tracks as add_slim_tracks",
        "dcs.cost_rmb_cents as day_cost",
        "dcs.sale_sgd_cents as day_sale",
        "ncs.cost_rmb_cents as night_cost",
        "ncs.sale_sgd_cents as night_sale",
        "tcs.cost_rmb_cents as toilet_cost",
        "tcs.sale_sgd_cents as toilet_sale",
        "pc.price_sgd_cents as combo_price",
      ])
      .where("rooms.order_id", "=", orderId)
      .execute(),
    db
      .selectFrom("pricing_assumptions")
      .selectAll()
      .where("singleton", "=", true)
      .executeTakeFirst(),
    db
      .selectFrom("pricing_addons")
      .select(["key", "cost_rmb_cents", "sale_sgd_cents", "basis"])
      .execute(),
  ]);

  if (!assumptionsRow) return null;

  const a = assumptionsRowToCalc(assumptionsRow);
  const book = addonRowsToBook(addonRows);
  const calcWindows: CalcWindow[] = windows.map(rowToCalcWindow);

  const result = computeQuote(
    calcWindows,
    book,
    a,
    order?.freight_mode ?? "air",
    order?.extra_install_sgd_cents ?? 0,
    order?.discount_bps ?? 0,
  );
  // Nothing priced yet → not worth showing a $0 quote.
  if (result.saleSgdCents === 0 && result.cogsRmbCents === 0) return null;

  // Carousell orders use the lower margin floor.
  const minMarginBps =
    order?.channel === "carousell"
      ? assumptionsRow.min_margin_carousell_bps
      : assumptionsRow.min_margin_bps;

  const stale = quoteStaleness(
    order?.price_calc_at_quote_cents ?? null,
    result.discountedSaleSgdCents,
  );

  return {
    ...result,
    minMarginBps,
    discountBps: order?.discount_bps ?? 0,
    promoLabel: order?.promo_label ?? null,
    isStale: stale.isStale,
    baselineCalcCents: stale.baselineCents,
  };
}

// Batched staleness check for the orders list: for a set of orders, recompute
// each order's live sale in a single sweep and compare it to its captured
// baseline. Returns a map orderId → isStale (absent/false = not stale). Avoids
// an N+1 of per-order computeOrderQuote calls on the list page.
export async function orderStaleFlags(
  orderIds: string[],
): Promise<Map<string, boolean>> {
  const flags = new Map<string, boolean>();
  if (orderIds.length === 0) return flags;

  const [orders, windows, assumptionsRow, addonRows] = await Promise.all([
    db
      .selectFrom("orders")
      .select([
        "id",
        "freight_mode",
        "extra_install_sgd_cents",
        "discount_bps",
        "price_calc_at_quote_cents",
      ])
      .where("id", "in", orderIds)
      .execute(),
    db
      .selectFrom("windows")
      .innerJoin("rooms", "rooms.id", "windows.room_id")
      .leftJoin("curtain_types as dct", "dct.id", "windows.day_curtain_type_id")
      .leftJoin("curtain_series as dcs", "dcs.id", "dct.series_id")
      .leftJoin(
        "curtain_types as nct",
        "nct.id",
        "windows.night_curtain_type_id",
      )
      .leftJoin("curtain_series as ncs", "ncs.id", "nct.series_id")
      .leftJoin("curtain_types as tct", "tct.id", "windows.curtain_type_id")
      .leftJoin("curtain_series as tcs", "tcs.id", "tct.series_id")
      .leftJoin("pricing_combos as pc", "pc.id", "windows.combo_id")
      .select([
        "rooms.order_id as order_id",
        "windows.width_cm as width_cm",
        "windows.add_s_fold as add_s_fold",
        "windows.add_slim_tracks as add_slim_tracks",
        "dcs.cost_rmb_cents as day_cost",
        "dcs.sale_sgd_cents as day_sale",
        "ncs.cost_rmb_cents as night_cost",
        "ncs.sale_sgd_cents as night_sale",
        "tcs.cost_rmb_cents as toilet_cost",
        "tcs.sale_sgd_cents as toilet_sale",
        "pc.price_sgd_cents as combo_price",
      ])
      .where("rooms.order_id", "in", orderIds)
      .execute(),
    db
      .selectFrom("pricing_assumptions")
      .selectAll()
      .where("singleton", "=", true)
      .executeTakeFirst(),
    db
      .selectFrom("pricing_addons")
      .select(["key", "cost_rmb_cents", "sale_sgd_cents", "basis"])
      .execute(),
  ]);

  if (!assumptionsRow) return flags;

  const a = assumptionsRowToCalc(assumptionsRow);
  const book = addonRowsToBook(addonRows);

  const windowsByOrder = new Map<string, CalcWindow[]>();
  for (const w of windows) {
    const list = windowsByOrder.get(w.order_id) ?? [];
    list.push(rowToCalcWindow(w));
    windowsByOrder.set(w.order_id, list);
  }

  for (const o of orders) {
    // No baseline captured → never stale (quoteStaleness handles the null).
    const live = computeQuote(
      windowsByOrder.get(o.id) ?? [],
      book,
      a,
      o.freight_mode,
      o.extra_install_sgd_cents,
      o.discount_bps,
    );
    flags.set(
      o.id,
      quoteStaleness(o.price_calc_at_quote_cents, live.discountedSaleSgdCents)
        .isStale,
    );
  }

  return flags;
}
