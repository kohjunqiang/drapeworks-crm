import "server-only";

import { db } from "@/lib/db/kysely";
import {
  computeQuote,
  type CalcAddonBook,
  type CalcAssumptions,
  type CalcWindow,
  type QuoteResult,
} from "./calculator";
import {
  computeMeshQuote,
  minimumKey,
  type MeshCalcAssumptions,
  type MeshPanel,
  type MeshPriceBook,
} from "./mesh-calculator";
import type { MeshDraw } from "@/lib/validation/mesh";

import { quoteStaleness } from "./quote-staleness";
import { computeStaleFlags } from "./stale-flags";

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
  handyman_mesh_sgd_cents: number;
  sea_freight_rmb_cents_per_m3: number;
  air_freight_rate_bps: number;
  air_freight_floor_rmb_cents: number;
  air_freight_cap_rmb_cents: number;
}): MeshCalcAssumptions {
  return {
    fxSgdToRmb: r.fx_sgd_to_rmb,
    gstBps: r.gst_bps,
    otherCostBps: r.other_cost_bps,
    groupbuyDiscountBps: r.groupbuy_discount_bps,
    styleMultiplier: r.style_multiplier,
    handymanSingleSgdCents: r.handyman_single_sgd_cents,
    handymanDoubleSgdCents: r.handyman_double_sgd_cents,
    handymanBlindsSgdCents: r.handyman_blinds_sgd_cents,
    handymanMeshSgdCents: r.handyman_mesh_sgd_cents,
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

// ── mesh ─────────────────────────────────────────────────────────────────

/** A catalogue row offered to the form. */
export type MeshCatalogueOption = {
  id: string;
  name: string;
  /**
   * False when the row is archived and is only present because an existing
   * order references it. The form shows it as the current selection but keeps
   * it out of the choosable options, so editing an old order neither blanks
   * the select nor lets someone newly pick a retired colour.
   */
  selectable: boolean;
};

export type MeshCalcConfig = {
  assumptions: MeshCalcAssumptions;
  book: MeshPriceBook;
  categories: MeshCatalogueOption[];
  colours: MeshCatalogueOption[];
  minMarginBps: number;
  minMarginCarousellBps: number;
};

/** Ids an existing order already references, kept resolvable even if archived. */
export type MeshInUseIds = {
  categoryIds?: string[];
  colourIds?: string[];
};

const uniq = (xs: string[]): string[] => [...new Set(xs)];

// The per-ft² rates + colour surcharges — everything the mesh calculator needs
// and nothing it doesn't. Shared by the single-order quote and the batched
// staleness sweep.
//
// Neither query filters on is_active: an archived category or colour must keep
// resolving to the rate an existing order was quoted at (§9).
export async function loadMeshPriceBook(): Promise<MeshPriceBook> {
  const [categoryRows, colourRows, bandRows, systemRows, minimumRows] =
    await Promise.all([
    db
      .selectFrom("mesh_categories")
      .select(["id", "cost_rmb_cents_per_sqft", "sale_sgd_cents_per_sqft"])
      .execute(),
    db
      .selectFrom("mesh_colours")
      .select(["id", "surcharge_rmb_cents", "surcharge_sgd_cents"])
      .execute(),
    // Active only for both: an archived band or system must stop deciding what
    // a NEW panel resolves to. Unlike categories and colours these are not
    // referenced by id from the panel row, so there is nothing to keep alive.
    db
      .selectFrom("mesh_system_bands")
      .select(["max_width_cm", "single_system", "double_system"])
      .where("is_active", "=", true)
      .execute(),
    db
      .selectFrom("mesh_systems")
      .select(["name", "double_cost_rmb_cents", "double_sale_sgd_cents"])
      .where("is_active", "=", true)
      .execute(),
    // Joined to resolve the system name the grid is keyed on. Not filtered on
    // is_active: a minimum must keep applying to an order already quoted under
    // a since-archived system.
    db
      .selectFrom("mesh_minimum_areas")
      .innerJoin("mesh_systems", "mesh_systems.id", "mesh_minimum_areas.system_id")
      .select([
        "mesh_minimum_areas.category_id as category_id",
        "mesh_systems.name as system_name",
        "mesh_minimum_areas.min_area_cm2_per_leaf as min_area_cm2_per_leaf",
      ])
      .execute(),
  ]);

  const rates: MeshPriceBook["rates"] = {};
  for (const r of categoryRows) {
    rates[r.id] = {
      costRmbCentsPerSqft: r.cost_rmb_cents_per_sqft,
      saleSgdCentsPerSqft: r.sale_sgd_cents_per_sqft,
    };
  }

  const colours: MeshPriceBook["colours"] = {};
  for (const r of colourRows) {
    colours[r.id] = {
      costRmbCents: r.surcharge_rmb_cents,
      saleSgdCents: r.surcharge_sgd_cents,
    };
  }

  const doubleSurcharges: MeshPriceBook["doubleSurcharges"] = {};
  for (const r of systemRows) {
    doubleSurcharges[r.name.trim().toLowerCase()] = {
      costRmbCents: r.double_cost_rmb_cents,
      saleSgdCents: r.double_sale_sgd_cents,
    };
  }

  const minimumAreas: MeshPriceBook["minimumAreas"] = {};
  for (const r of minimumRows) {
    minimumAreas[minimumKey(r.category_id, r.system_name)] =
      r.min_area_cm2_per_leaf;
  }

  return {
    rates,
    colours,
    minimumAreas,
    bands: bandRows.map((b) => ({
      maxWidthCm: b.max_width_cm,
      singleSystem: b.single_system,
      doubleSystem: b.double_system,
    })),
    doubleSurcharges,
  };
}

// The mesh parallel to loadCalcConfig: plain serialisable objects so the whole
// price book crosses the server→client boundary as props for the live quote.
//
// `inUse` widens the active catalogue with rows an order already references.
// Without it, editing an order that uses an archived colour would render a
// blank select and silently drop the value on save (§9 requires archived rows
// stay resolvable). /orders/new passes nothing and gets active rows only.
export async function loadMeshCalcConfig(
  inUse: MeshInUseIds = {},
): Promise<MeshCalcConfig | null> {
  const inUseCategories = uniq(inUse.categoryIds ?? []);
  const inUseColours = uniq(inUse.colourIds ?? []);

  const [assumptionsRow, categoryRows, colourRows, book] =
    await Promise.all([
      db
        .selectFrom("pricing_assumptions")
        .selectAll()
        .where("singleton", "=", true)
        .executeTakeFirst(),
      db
        .selectFrom("mesh_categories")
        .select(["id", "name", "is_active"])
        .where((eb) =>
          eb.or([
            eb("is_active", "=", true),
            ...(inUseCategories.length
              ? [eb("id", "in", inUseCategories)]
              : []),
          ]),
        )
        .orderBy("position")
        .orderBy("name")
        .execute(),
      db
        .selectFrom("mesh_colours")
        .select(["id", "name", "is_active"])
        .where((eb) =>
          eb.or([
            eb("is_active", "=", true),
            ...(inUseColours.length ? [eb("id", "in", inUseColours)] : []),
          ]),
        )
        .orderBy("position")
        .orderBy("name")
        .execute(),
      loadMeshPriceBook(),
    ]);

  if (!assumptionsRow) return null;

  const toOption = (r: {
    id: string;
    name: string;
    is_active: boolean;
  }): MeshCatalogueOption => ({
    id: r.id,
    name: r.name,
    selectable: r.is_active,
  });

  return {
    assumptions: assumptionsRowToCalc(assumptionsRow),
    // The book carries every category's rate, archived or not, so an order
    // quoted under a since-retired category keeps resolving to its price.
    book,
    categories: categoryRows.map(toOption),
    colours: colourRows.map(toOption),
    minMarginBps: assumptionsRow.min_margin_bps,
    minMarginCarousellBps: assumptionsRow.min_margin_carousell_bps,
  };
}

type MeshPanelRow = {
  category_id: string | null;
  colour_id: string | null;
  width_cm: number | null;
  height_cm: number | null;
  draw: MeshDraw | null;
};

const rowToMeshPanel = (p: MeshPanelRow): MeshPanel => ({
  categoryId: p.category_id,
  colourId: p.colour_id,
  widthCm: p.width_cm,
  heightCm: p.height_cm,
  // Carried into pricing because a double draw attracts a system surcharge.
  draw: p.draw,
});

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
  blind_cost: number | null;
  blind_sale: number | null;
  combo_price: number | null;
};

function rowToCalcWindow(w: WindowPriceRow): CalcWindow {
  // A blind occupies the window instead of curtains, so it short-circuits:
  // no day/night leg, no add-ons, no combo. windowQuote applies the same rule
  // itself, but sending clean input keeps the two engines honest.
  if (w.blind_sale != null || w.blind_cost != null) {
    return {
      widthCm: w.width_cm,
      blindPrice: { costRmbCents: w.blind_cost, saleSgdCents: w.blind_sale },
      addSFold: false,
      addSlimTracks: false,
      comboPriceSgdCents: null,
    };
  }

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
        "product_line",
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
      .leftJoin("curtain_types as bct", "bct.id", "windows.blind_type_id")
      .leftJoin("curtain_series as bcs", "bcs.id", "bct.series_id")
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
        "bcs.cost_rmb_cents as blind_cost",
        "bcs.sale_sgd_cents as blind_sale",
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

  // Mesh orders have no `windows` rows at all — quoting them through the
  // curtain engine would return a $0 quote. Route on the discriminator.
  const result =
    order?.product_line === "mesh"
      ? computeMeshQuote(
          (
            await db
              .selectFrom("mesh_panels")
              .innerJoin("rooms", "rooms.id", "mesh_panels.room_id")
              .select([
                "mesh_panels.category_id as category_id",
                "mesh_panels.colour_id as colour_id",
                "mesh_panels.width_cm as width_cm",
                "mesh_panels.height_cm as height_cm",
                "mesh_panels.draw as draw",
              ])
              .where("rooms.order_id", "=", orderId)
              .execute()
          ).map(rowToMeshPanel),
          await loadMeshPriceBook(),
          a,
          order.freight_mode,
          order.extra_install_sgd_cents,
          order.discount_bps,
        )
      : computeQuote(
          windows.map(rowToCalcWindow) satisfies CalcWindow[],
          addonRowsToBook(addonRows),
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

  const [orders, windows, meshPanels, meshBook, assumptionsRow, addonRows] =
    await Promise.all([
      db
        .selectFrom("orders")
        .select([
          "id",
          "product_line",
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
        .leftJoin(
          "curtain_types as dct",
          "dct.id",
          "windows.day_curtain_type_id",
        )
        .leftJoin("curtain_series as dcs", "dcs.id", "dct.series_id")
        .leftJoin(
          "curtain_types as nct",
          "nct.id",
          "windows.night_curtain_type_id",
        )
        .leftJoin("curtain_series as ncs", "ncs.id", "nct.series_id")
        .leftJoin("curtain_types as tct", "tct.id", "windows.curtain_type_id")
        .leftJoin("curtain_series as tcs", "tcs.id", "tct.series_id")
        .leftJoin("curtain_types as bct", "bct.id", "windows.blind_type_id")
        .leftJoin("curtain_series as bcs", "bcs.id", "bct.series_id")
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
          "bcs.cost_rmb_cents as blind_cost",
          "bcs.sale_sgd_cents as blind_sale",
          "pc.price_sgd_cents as combo_price",
        ])
        .where("rooms.order_id", "in", orderIds)
        .execute(),
      // Mesh panels for the same sweep. A mesh order has zero `windows` rows, so
      // without this it would quote at $0 against a non-null baseline and show a
      // re-quote banner that no action could ever clear.
      db
        .selectFrom("mesh_panels")
        .innerJoin("rooms", "rooms.id", "mesh_panels.room_id")
        .select([
          "rooms.order_id as order_id",
          "mesh_panels.category_id as category_id",
          "mesh_panels.colour_id as colour_id",
          "mesh_panels.width_cm as width_cm",
          "mesh_panels.height_cm as height_cm",
          "mesh_panels.draw as draw",
        ])
        .where("rooms.order_id", "in", orderIds)
        .execute(),
      loadMeshPriceBook(),
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

  const panelsByOrder = new Map<string, MeshPanel[]>();
  for (const p of meshPanels) {
    const list = panelsByOrder.get(p.order_id) ?? [];
    list.push(rowToMeshPanel(p));
    panelsByOrder.set(p.order_id, list);
  }

  // The routing decision itself lives in a pure module so it can be tested
  // without a database — see stale-flags.test.ts.
  return computeStaleFlags({
    orders,
    windowsByOrder,
    panelsByOrder,
    book,
    meshBook,
    assumptions: a,
  });
}
