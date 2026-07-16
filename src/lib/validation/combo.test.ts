import { describe, expect, it } from "vitest";

import { comboSchema } from "./combo";

const UUID = "550e8400-e29b-41d4-a716-446655440000";

describe("comboSchema", () => {
  it("accepts a new combo with a name + price, no series", () => {
    const parsed = comboSchema.parse({
      isNew: true,
      name: "Signature Set",
      price_sgd: "450",
    });
    expect(parsed.name).toBe("Signature Set");
    expect(parsed.price_sgd).toBe("450");
    expect(parsed.day_series_id).toBeUndefined();
  });

  it("accepts day/night series ids and normalises empty strings to undefined", () => {
    const parsed = comboSchema.parse({
      isNew: true,
      name: "Combo",
      day_series_id: UUID,
      night_series_id: "",
      price_sgd: "399.90",
    });
    expect(parsed.day_series_id).toBe(UUID);
    expect(parsed.night_series_id).toBeUndefined();
  });

  it("rejects a non-numeric price", () => {
    expect(() =>
      comboSchema.parse({ isNew: true, name: "Combo", price_sgd: "free" }),
    ).toThrow();
  });

  it("rejects an empty name", () => {
    expect(() =>
      comboSchema.parse({ isNew: true, name: "", price_sgd: "100" }),
    ).toThrow();
  });
});
