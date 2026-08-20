import "server-only";

import { db } from "@/lib/db/kysely";
import { centsToDisplay } from "@/lib/money";
import type { AssumptionsRow } from "@/lib/validation/pricing-settings";

// The single global assumptions row (storage-scale integers). Callers convert
// to human units with assumptionsFromStorage.
export async function loadAssumptions(): Promise<AssumptionsRow | null> {
  const r = await db
    .selectFrom("pricing_assumptions")
    .selectAll()
    .where("singleton", "=", true)
    .executeTakeFirst();
  if (!r) return null;
  return {
    fx_sgd_to_rmb: r.fx_sgd_to_rmb,
    gst_bps: r.gst_bps,
    other_cost_bps: r.other_cost_bps,
    groupbuy_discount_bps: r.groupbuy_discount_bps,
    style_multiplier: r.style_multiplier,
    handyman_single_sgd_cents: r.handyman_single_sgd_cents,
    handyman_double_sgd_cents: r.handyman_double_sgd_cents,
    handyman_blinds_sgd_cents: r.handyman_blinds_sgd_cents,
    handyman_mesh_sgd_cents: r.handyman_mesh_sgd_cents,
    sea_freight_rmb_cents_per_m3: r.sea_freight_rmb_cents_per_m3,
    air_freight_rate_bps: r.air_freight_rate_bps,
    air_freight_floor_rmb_cents: r.air_freight_floor_rmb_cents,
    air_freight_cap_rmb_cents: r.air_freight_cap_rmb_cents,
    min_margin_bps: r.min_margin_bps,
    min_margin_carousell_bps: r.min_margin_carousell_bps,
    track_cost_rmb_cents_per_m: r.track_cost_rmb_cents_per_m,
  };
}

export type AddonRow = {
  id: string;
  key: string;
  label: string;
  cost_rmb: string | null; // decimal strings for the edit form
  sale_sgd: string | null;
  basis: "per_metre" | "per_unit";
  is_active: boolean;
};

/**
 * Add-ons the rail no longer is.
 *
 * The rows are kept (nothing is hard-deleted) but they must not appear on the
 * settings screen: the calculator stopped reading them when the rail became a
 * cost per metre on the assumptions row, so editing them here would change a
 * price that nothing charges. Keeping them listed-but-archived is the same trap
 * one step removed — the screen has a Reactivate button.
 */
const RETIRED_KEYS = ["single_track", "double_track"];

export async function loadAddons(): Promise<AddonRow[]> {
  const rows = await db
    .selectFrom("pricing_addons")
    .select([
      "id",
      "key",
      "label",
      "cost_rmb_cents",
      "sale_sgd_cents",
      "basis",
      "is_active",
    ])
    .where("key", "not in", RETIRED_KEYS)
    .orderBy("is_active", "desc")
    .orderBy("label", "asc")
    .execute();
  return rows.map((r) => ({
    id: r.id,
    key: r.key,
    label: r.label,
    cost_rmb: r.cost_rmb_cents != null ? centsToDisplay(r.cost_rmb_cents) : null,
    sale_sgd: r.sale_sgd_cents != null ? centsToDisplay(r.sale_sgd_cents) : null,
    basis: r.basis,
    is_active: r.is_active,
  }));
}
