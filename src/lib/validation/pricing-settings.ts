import { z } from "zod";

// Assumptions as entered on the settings form (human-friendly units). The
// action converts these to the integer storage scale (money = cents; rates &
// multipliers ×10000). Kept as plain numbers here; z.coerce handles the string
// inputs the form sends.
export const assumptionsSchema = z.object({
  fx: z.coerce.number().positive().max(1000), // SGD → RMB, e.g. 5.3
  gstPct: z.coerce.number().min(0).max(100),
  otherCostPct: z.coerce.number().min(0).max(100),
  groupbuyDiscountPct: z.coerce.number().min(0).max(100),
  styleMultiplier: z.coerce.number().min(0).max(100), // e.g. 2
  handymanSingleSgd: z.coerce.number().min(0).max(1_000_000),
  handymanDoubleSgd: z.coerce.number().min(0).max(1_000_000),
  handymanBlindsSgd: z.coerce.number().min(0).max(1_000_000),
  handymanMeshSgd: z.coerce.number().min(0).max(1_000_000),
  seaFreightRmb: z.coerce.number().min(0).max(10_000_000),
  airFreightRatePct: z.coerce.number().min(0).max(100),
  airFreightFloorRmb: z.coerce.number().min(0).max(10_000_000),
  airFreightCapRmb: z.coerce.number().min(0).max(10_000_000),
  minMarginPct: z.coerce.number().min(0).max(100),
  minMarginCarousellPct: z.coerce.number().min(0).max(100),
  // The rail, per metre of the window's measured width. One rate: a double
  // rail is two runs of the same rail, so it bills twice the width. It has no
  // sale price — we never bill it — which is why it is here and not an add-on.
  trackCostRmb: z.coerce.number().min(0).max(10_000_000),
});

export type AssumptionsInput = z.infer<typeof assumptionsSchema>;

// storage-scale row (integer columns)
export type AssumptionsRow = {
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
  min_margin_bps: number;
  min_margin_carousell_bps: number;
  track_cost_rmb_cents_per_m: number;
};

const pct = (n: number) => Math.round(n * 100); // 9(%)   → 900
const ratio = (n: number) => Math.round(n * 10000); // 5.3 → 53000
const cents = (n: number) => Math.round(n * 100); // $100   → 10000

export function assumptionsToStorage(h: AssumptionsInput): AssumptionsRow {
  return {
    fx_sgd_to_rmb: ratio(h.fx),
    gst_bps: pct(h.gstPct),
    other_cost_bps: pct(h.otherCostPct),
    groupbuy_discount_bps: pct(h.groupbuyDiscountPct),
    style_multiplier: ratio(h.styleMultiplier),
    handyman_single_sgd_cents: cents(h.handymanSingleSgd),
    handyman_double_sgd_cents: cents(h.handymanDoubleSgd),
    handyman_blinds_sgd_cents: cents(h.handymanBlindsSgd),
    handyman_mesh_sgd_cents: cents(h.handymanMeshSgd),
    sea_freight_rmb_cents_per_m3: cents(h.seaFreightRmb),
    air_freight_rate_bps: pct(h.airFreightRatePct),
    air_freight_floor_rmb_cents: cents(h.airFreightFloorRmb),
    air_freight_cap_rmb_cents: cents(h.airFreightCapRmb),
    min_margin_bps: pct(h.minMarginPct),
    min_margin_carousell_bps: pct(h.minMarginCarousellPct),
    track_cost_rmb_cents_per_m: cents(h.trackCostRmb),
  };
}

export function assumptionsFromStorage(r: AssumptionsRow): AssumptionsInput {
  return {
    fx: r.fx_sgd_to_rmb / 10000,
    gstPct: r.gst_bps / 100,
    otherCostPct: r.other_cost_bps / 100,
    groupbuyDiscountPct: r.groupbuy_discount_bps / 100,
    styleMultiplier: r.style_multiplier / 10000,
    handymanSingleSgd: r.handyman_single_sgd_cents / 100,
    handymanDoubleSgd: r.handyman_double_sgd_cents / 100,
    handymanBlindsSgd: r.handyman_blinds_sgd_cents / 100,
    handymanMeshSgd: r.handyman_mesh_sgd_cents / 100,
    seaFreightRmb: r.sea_freight_rmb_cents_per_m3 / 100,
    airFreightRatePct: r.air_freight_rate_bps / 100,
    airFreightFloorRmb: r.air_freight_floor_rmb_cents / 100,
    airFreightCapRmb: r.air_freight_cap_rmb_cents / 100,
    minMarginPct: r.min_margin_bps / 100,
    minMarginCarousellPct: r.min_margin_carousell_bps / 100,
    trackCostRmb: r.track_cost_rmb_cents_per_m / 100,
  };
}

// Add-on edit (label + decimal cost/sale + basis). The key is immutable.
const priceField = z
  .union([
    z.literal(""),
    z
      .string()
      .regex(/^\d+(\.\d{1,2})?$/, "Enter a valid amount (e.g. 27 or 50.00)"),
  ])
  .optional();

export const pricingAddonSchema = z
  .object({
    // Absent on a row being created — the action generates the key and the id.
    id: z.string().uuid().optional(),
    label: z.string().trim().min(1, "Required").max(120),
    cost_rmb: priceField,
    sale_sgd: priceField,
    basis: z.enum(["per_metre", "per_unit"]),
    // Which covering offers this add-on, and how it gets ticked. 'curtain' /
    // 'manual' match the column defaults: a row added by hand fails safe —
    // visible on curtains, never silently auto-charged.
    applies_to: z.enum(["curtain", "blind", "both"]).default("curtain"),
    auto_rule: z.enum(["manual", "always", "width_over"]).default("manual"),
    auto_width_over_cm: z.coerce
      .number()
      .int()
      .positive()
      .max(1000)
      .nullable()
      .optional(),
    is_active: z.boolean().optional(),
  })
  // Mirrors the pricing_addons_auto_width_agrees check constraint, so a bad
  // combination is a field error rather than a 500 out of Postgres.
  .refine((v) => v.auto_rule !== "width_over" || v.auto_width_over_cm != null, {
    message: "Enter the width it applies over",
    path: ["auto_width_over_cm"],
  })
  .refine((v) => v.auto_rule === "width_over" || v.auto_width_over_cm == null, {
    message: "Only 'over width' uses a threshold",
    path: ["auto_width_over_cm"],
  });

export type PricingAddonInput = z.infer<typeof pricingAddonSchema>;
