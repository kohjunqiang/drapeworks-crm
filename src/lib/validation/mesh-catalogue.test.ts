import { describe, expect, it } from "vitest";

import { meshCategorySchema, meshColourSchema } from "./mesh-catalogue";

const UUID = "11111111-1111-4111-8111-111111111111";

const category = (over: Record<string, unknown> = {}) => ({
  isNew: true,
  name: "AirGuard",
  ...over,
});

describe("meshCategorySchema", () => {
  it("accepts a fully priced category", () => {
    const r = meshCategorySchema.safeParse(
      category({
        description: "Insect mesh",
        vendor_id: UUID,
        cost_rmb_per_sqft: "4",
        sale_sgd_per_sqft: "8.50",
      }),
    );
    expect(r.success).toBe(true);
  });

  it("accepts a category with no rates — created before it is priced", () => {
    const r = meshCategorySchema.safeParse(
      category({ cost_rmb_per_sqft: "", sale_sgd_per_sqft: "" }),
    );
    expect(r.success).toBe(true);
  });

  it("accepts a sale rate with the cost still blank", () => {
    // A real state: the calculator reports it via missingCostPanels rather
    // than rejecting it, so the quote is still usable.
    const r = meshCategorySchema.safeParse(
      category({ cost_rmb_per_sqft: "", sale_sgd_per_sqft: "8" }),
    );
    expect(r.success).toBe(true);
  });

  it("rejects a rate with three decimal places", () => {
    const r = meshCategorySchema.safeParse(
      category({ sale_sgd_per_sqft: "8.505" }),
    );
    expect(r.success).toBe(false);
  });

  it("rejects a non-numeric rate", () => {
    const r = meshCategorySchema.safeParse(
      category({ sale_sgd_per_sqft: "eight" }),
    );
    expect(r.success).toBe(false);
  });

  it("requires a name", () => {
    expect(meshCategorySchema.safeParse(category({ name: "  " })).success).toBe(
      false,
    );
  });
});

describe("meshColourSchema", () => {
  it("accepts a flat per-panel surcharge", () => {
    const r = meshColourSchema.safeParse({
      isNew: true,
      name: "Bronze",
      surcharge_rmb: "20",
      surcharge_sgd: "35.00",
    });
    expect(r.success).toBe(true);
  });

  it("accepts a colour with no surcharge", () => {
    const r = meshColourSchema.safeParse({
      isNew: true,
      name: "White",
      surcharge_rmb: "",
      surcharge_sgd: "",
    });
    expect(r.success).toBe(true);
  });

  it("requires a name", () => {
    expect(
      meshColourSchema.safeParse({ isNew: true, name: "  " }).success,
    ).toBe(false);
  });
});
