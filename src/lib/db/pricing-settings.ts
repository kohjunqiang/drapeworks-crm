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
    premium_bps: r.premium_bps,
    groupbuy_discount_bps: r.groupbuy_discount_bps,
    style_multiplier: r.style_multiplier,
    handyman_sgd_cents: r.handyman_sgd_cents,
    sea_freight_rmb_cents_per_m3: r.sea_freight_rmb_cents_per_m3,
    air_freight_rate_bps: r.air_freight_rate_bps,
    air_freight_floor_rmb_cents: r.air_freight_floor_rmb_cents,
    air_freight_cap_rmb_cents: r.air_freight_cap_rmb_cents,
    min_margin_bps: r.min_margin_bps,
    min_margin_carousell_bps: r.min_margin_carousell_bps,
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
