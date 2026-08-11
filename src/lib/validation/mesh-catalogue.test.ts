import { describe, expect, it } from "vitest";

import {
  cm2ToSqm,
  meshPriceCellSchema,
  meshSizeBandSchema,
  sqmToCm2,
} from "./mesh-catalogue";

const UUID = "11111111-1111-4111-8111-111111111111";

describe("area conversion", () => {
  it("converts m² to integer cm² with no float residue", () => {
    expect(sqmToCm2("2")).toBe(20000);
    expect(sqmToCm2("2.5")).toBe(25000);
    expect(sqmToCm2("0.75")).toBe(7500);
  });

  it("treats a blank threshold as the open-ended band", () => {
    expect(sqmToCm2("")).toBeNull();
    expect(sqmToCm2(undefined)).toBeNull();
  });

  it("round-trips", () => {
    for (const sqm of ["2", "2.5", "0.75", "12"]) {
      expect(cm2ToSqm(sqmToCm2(sqm))).toBe(sqm);
    }
    expect(cm2ToSqm(null)).toBe("");
  });
});

describe("meshSizeBandSchema", () => {
  it("accepts a bounded band", () => {
    const r = meshSizeBandSchema.safeParse({
      isNew: true,
      label: "Up to 2 m²",
      max_area_sqm: "2",
    });
    expect(r.success).toBe(true);
  });

  it("accepts a blank threshold as the open-ended band", () => {
    const r = meshSizeBandSchema.safeParse({
      isNew: true,
      label: "Above 4 m²",
      max_area_sqm: "",
    });
    expect(r.success).toBe(true);
  });

  it("rejects a non-numeric threshold", () => {
    const r = meshSizeBandSchema.safeParse({
      isNew: true,
      label: "Big",
      max_area_sqm: "two",
    });
    expect(r.success).toBe(false);
  });

  it("requires a label", () => {
    expect(
      meshSizeBandSchema.safeParse({ isNew: true, label: "  " }).success,
    ).toBe(false);
  });
});

describe("meshPriceCellSchema", () => {
  it("accepts a fully priced cell", () => {
    const r = meshPriceCellSchema.safeParse({
      category_id: UUID,
      band_id: UUID,
      cost_rmb: "120",
      sale_sgd: "180.50",
    });
    expect(r.success).toBe(true);
  });

  it("accepts a half-filled cell — sale set, cost blank", () => {
    // A real state: the grid gets created then filled in cell by cell. The
    // calculator reports it via missingCostPanels rather than rejecting it.
    const r = meshPriceCellSchema.safeParse({
      category_id: UUID,
      band_id: UUID,
      cost_rmb: "",
      sale_sgd: "180",
    });
    expect(r.success).toBe(true);
  });

  it("accepts a wholly empty cell", () => {
    const r = meshPriceCellSchema.safeParse({
      category_id: UUID,
      band_id: UUID,
      cost_rmb: "",
      sale_sgd: "",
    });
    expect(r.success).toBe(true);
  });

  it("rejects a price with three decimal places", () => {
    const r = meshPriceCellSchema.safeParse({
      category_id: UUID,
      band_id: UUID,
      sale_sgd: "180.505",
    });
    expect(r.success).toBe(false);
  });
});
