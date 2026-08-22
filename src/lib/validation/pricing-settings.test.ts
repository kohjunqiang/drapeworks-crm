import { describe, expect, it } from "vitest";

import {
  assumptionsFromStorage,
  assumptionsToStorage,
  assumptionsSchema,
  pricingAddonSchema,
  type AssumptionsRow,
} from "./pricing-settings";

const EXCEL_ROW: AssumptionsRow = {
  fx_sgd_to_rmb: 53000,
  gst_bps: 900,
  other_cost_bps: 1000,
  groupbuy_discount_bps: 1500,
  style_multiplier: 20000,
  handyman_single_sgd_cents: 6000,
  handyman_double_sgd_cents: 10000,
  handyman_blinds_sgd_cents: 8000,
  handyman_mesh_sgd_cents: 4500,
  sea_freight_rmb_cents_per_m3: 40000,
  air_freight_rate_bps: 6000,
  air_freight_floor_rmb_cents: 50000,
  air_freight_cap_rmb_cents: 140000,
  min_margin_bps: 3500,
  min_margin_carousell_bps: 3000,
  track_cost_rmb_cents_per_m: 2500,
};

describe("assumptions conversion", () => {
  it("maps storage → human units correctly (Excel values)", () => {
    const h = assumptionsFromStorage(EXCEL_ROW);
    expect(h.fx).toBe(5.3);
    expect(h.gstPct).toBe(9);
    expect(h.otherCostPct).toBe(10);
    expect(h.groupbuyDiscountPct).toBe(15);
    expect(h.styleMultiplier).toBe(2);
    expect(h.handymanSingleSgd).toBe(60);
    expect(h.handymanDoubleSgd).toBe(100);
    expect(h.handymanBlindsSgd).toBe(80);
    expect(h.handymanMeshSgd).toBe(45);
    expect(h.seaFreightRmb).toBe(400);
    expect(h.airFreightRatePct).toBe(60);
    expect(h.airFreightFloorRmb).toBe(500);
    expect(h.airFreightCapRmb).toBe(1400);
    expect(h.minMarginPct).toBe(35);
    expect(h.minMarginCarousellPct).toBe(30);
  });

  it("round-trips human → storage → human", () => {
    const h = assumptionsFromStorage(EXCEL_ROW);
    expect(assumptionsToStorage(h)).toEqual(EXCEL_ROW);
  });

  it("coerces string form inputs to numbers", () => {
    const parsed = assumptionsSchema.parse({
      fx: "5.3",
      gstPct: "9",
      otherCostPct: "10",
      groupbuyDiscountPct: "15",
      styleMultiplier: "2",
      handymanSingleSgd: "60",
      handymanDoubleSgd: "100",
      handymanBlindsSgd: "80",
      handymanMeshSgd: "45",
      seaFreightRmb: "400",
      airFreightRatePct: "60",
      airFreightFloorRmb: "500",
      airFreightCapRmb: "1400",
      minMarginPct: "35",
      minMarginCarousellPct: "30",
      trackCostRmb: "25",
    });
    expect(assumptionsToStorage(parsed)).toEqual(EXCEL_ROW);
  });

  it("rejects a negative percentage", () => {
    expect(() =>
      assumptionsSchema.parse({
        fx: 5.3,
        gstPct: -1,
        otherCostPct: 10,
        groupbuyDiscountPct: 15,
        styleMultiplier: 2,
        handymanSingleSgd: 60,
        handymanDoubleSgd: 100,
        handymanBlindsSgd: 80,
        seaFreightRmb: 400,
        airFreightRatePct: 60,
        airFreightFloorRmb: 500,
        airFreightCapRmb: 1400,
        minMarginPct: 35,
        minMarginCarousellPct: 30,
      }),
    ).toThrow();
  });
});

describe("pricingAddonSchema", () => {
  it("accepts an add-on with decimal cost/sale", () => {
    const parsed = pricingAddonSchema.parse({
      id: "550e8400-e29b-41d4-a716-446655440000",
      label: "Blackout",
      cost_rmb: "27",
      sale_sgd: "50",
      basis: "per_metre",
    });
    expect(parsed.label).toBe("Blackout");
    expect(parsed.basis).toBe("per_metre");
  });

  it("rejects an invalid basis", () => {
    expect(() =>
      pricingAddonSchema.parse({
        id: "550e8400-e29b-41d4-a716-446655440000",
        label: "X",
        basis: "per_km",
      }),
    ).toThrow();
  });

  it("defaults a new add-on to curtains, by hand", () => {
    const parsed = pricingAddonSchema.parse({
      label: "Motorised",
      basis: "per_unit",
    });
    expect(parsed.applies_to).toBe("curtain");
    expect(parsed.auto_rule).toBe("manual");
    expect(parsed.id).toBeUndefined();
  });

  it("requires a threshold for width_over", () => {
    const r = pricingAddonSchema.safeParse({
      label: "Extra shipping",
      basis: "per_unit",
      applies_to: "blind",
      auto_rule: "width_over",
    });
    expect(r.success).toBe(false);
  });

  it("accepts width_over with a threshold", () => {
    const r = pricingAddonSchema.safeParse({
      label: "Extra shipping",
      basis: "per_unit",
      applies_to: "blind",
      auto_rule: "width_over",
      auto_width_over_cm: 200,
    });
    expect(r.success).toBe(true);
  });

  it("rejects a threshold on a by-hand add-on", () => {
    // Mirrors the pricing_addons_auto_width_agrees check constraint, so the
    // combination is a field error rather than a 500 out of Postgres.
    const r = pricingAddonSchema.safeParse({
      label: "Blackout",
      basis: "per_metre",
      auto_rule: "manual",
      auto_width_over_cm: 200,
    });
    expect(r.success).toBe(false);
  });
});
