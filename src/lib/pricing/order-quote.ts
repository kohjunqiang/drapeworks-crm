import "server-only";

import { db } from "@/lib/db/kysely";
import {
  computeQuote,
  type CalcAddonBook,
  type CalcAssumptions,
  type CalcWindow,
  type QuoteResult,
} from "./calculator";

export type OrderQuote = QuoteResult & {
  minMarginBps: number; // for the "below floor?" warning
};

// Resolve an order's windows → calculator inputs (each window's day/night
// series price + add-on toggles), pull the assumptions + add-on prices, and
// run the engine. Returns null if there are no priced windows to quote.
export async function computeOrderQuote(
  orderId: string,
): Promise<OrderQuote | null> {
  const [windows, assumptionsRow, addonRows] = await Promise.all([
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

  const a: CalcAssumptions = {
    fxSgdToRmb: assumptionsRow.fx_sgd_to_rmb,
    gstBps: assumptionsRow.gst_bps,
    otherCostBps: assumptionsRow.other_cost_bps,
    groupbuyDiscountBps: assumptionsRow.groupbuy_discount_bps,
    styleMultiplier: assumptionsRow.style_multiplier,
    handymanSgdCents: assumptionsRow.handyman_sgd_cents,
    airFreightRateBps: assumptionsRow.air_freight_rate_bps,
    airFreightFloorRmbCents: assumptionsRow.air_freight_floor_rmb_cents,
    airFreightCapRmbCents: assumptionsRow.air_freight_cap_rmb_cents,
  };

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
  const book: CalcAddonBook = {
    sFold: toAddon("s_fold"),
    slimTracks: toAddon("slim_tracks"),
    singleTrack: toAddon("single_track"),
    doubleTrack: toAddon("double_track"),
  };

  const calcWindows: CalcWindow[] = windows.map((w) => {
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
    };
  });

  const result = computeQuote(calcWindows, book, a);
  // Nothing priced yet → not worth showing a $0 quote.
  if (result.saleSgdCents === 0 && result.cogsRmbCents === 0) return null;

  return { ...result, minMarginBps: assumptionsRow.min_margin_bps };
}
