import { z } from "zod";

// Assumptions as entered on the settings form (human-friendly units). The
// action converts these to the integer storage scale (money = cents; rates &
// multipliers ×10000). Kept as plain numbers here; z.coerce handles the string
// inputs the form sends.
export const assumptionsSchema = z.object({
  fx: z.coerce.number().positive().max(1000), // SGD → RMB, e.g. 5.3
  gstPct: z.coerce.number().min(0).max(100),
  otherCostPct: z.coerce.number().min(0).max(100),
  premium: z.coerce.number().min(0).max(1000), // e.g. 1.15
  groupbuyDiscountPct: z.coerce.number().min(0).max(100),
  styleMultiplier: z.coerce.number().min(0).max(100), // e.g. 2
  handymanSgd: z.coerce.number().min(0).max(1_000_000),
  seaFreightRmb: z.coerce.number().min(0).max(10_000_000),
  airFreightRatePct: z.coerce.number().min(0).max(100),
  airFreightFloorRmb: z.coerce.number().min(0).max(10_000_000),
  airFreightCapRmb: z.coerce.number().min(0).max(10_000_000),
  minMarginPct: z.coerce.number().min(0).max(100),
  minMarginCarousellPct: z.coerce.number().min(0).max(100),
});

export type AssumptionsInput = z.infer<typeof assumptionsSchema>;

// storage-scale row (integer columns)
export type AssumptionsRow = {
  fx_sgd_to_rmb: number;
  gst_bps: number;
  other_cost_bps: number;
  premium_bps: number;
  groupbuy_discount_bps: number;
  style_multiplier: number;
  handyman_sgd_cents: number;
  sea_freight_rmb_cents_per_m3: number;
  air_freight_rate_bps: number;
  air_freight_floor_rmb_cents: number;
  air_freight_cap_rmb_cents: number;
  min_margin_bps: number;
  min_margin_carousell_bps: number;
};

const pct = (n: number) => Math.round(n * 100); // 9(%)   → 900
const ratio = (n: number) => Math.round(n * 10000); // 5.3 → 53000
const cents = (n: number) => Math.round(n * 100); // $100   → 10000

export function assumptionsToStorage(h: AssumptionsInput): AssumptionsRow {
  return {
    fx_sgd_to_rmb: ratio(h.fx),
    gst_bps: pct(h.gstPct),
    other_cost_bps: pct(h.otherCostPct),
    premium_bps: ratio(h.premium),
    groupbuy_discount_bps: pct(h.groupbuyDiscountPct),
    style_multiplier: ratio(h.styleMultiplier),
    handyman_sgd_cents: cents(h.handymanSgd),
    sea_freight_rmb_cents_per_m3: cents(h.seaFreightRmb),
    air_freight_rate_bps: pct(h.airFreightRatePct),
    air_freight_floor_rmb_cents: cents(h.airFreightFloorRmb),
    air_freight_cap_rmb_cents: cents(h.airFreightCapRmb),
    min_margin_bps: pct(h.minMarginPct),
    min_margin_carousell_bps: pct(h.minMarginCarousellPct),
  };
}

export function assumptionsFromStorage(r: AssumptionsRow): AssumptionsInput {
  return {
    fx: r.fx_sgd_to_rmb / 10000,
    gstPct: r.gst_bps / 100,
    otherCostPct: r.other_cost_bps / 100,
    premium: r.premium_bps / 10000,
    groupbuyDiscountPct: r.groupbuy_discount_bps / 100,
    styleMultiplier: r.style_multiplier / 10000,
    handymanSgd: r.handyman_sgd_cents / 100,
    seaFreightRmb: r.sea_freight_rmb_cents_per_m3 / 100,
    airFreightRatePct: r.air_freight_rate_bps / 100,
    airFreightFloorRmb: r.air_freight_floor_rmb_cents / 100,
    airFreightCapRmb: r.air_freight_cap_rmb_cents / 100,
    minMarginPct: r.min_margin_bps / 100,
    minMarginCarousellPct: r.min_margin_carousell_bps / 100,
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

export const pricingAddonSchema = z.object({
  id: z.string().uuid(),
  label: z.string().trim().min(1, "Required").max(120),
  cost_rmb: priceField,
  sale_sgd: priceField,
  basis: z.enum(["per_metre", "per_unit"]),
  is_active: z.boolean().optional(),
});

export type PricingAddonInput = z.infer<typeof pricingAddonSchema>;
