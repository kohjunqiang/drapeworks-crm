import { describe, expect, it } from "vitest";

import { promotionSchema } from "./promotion";

describe("promotionSchema", () => {
  it("accepts a new promotion with a name + percent", () => {
    const parsed = promotionSchema.parse({
      isNew: true,
      name: "CNY Sale",
      discountPct: 15,
    });
    expect(parsed.name).toBe("CNY Sale");
    expect(parsed.discountPct).toBe(15);
  });

  it("coerces a string percent and trims the name", () => {
    const parsed = promotionSchema.parse({
      isNew: true,
      name: "  Launch ",
      discountPct: "10",
    });
    expect(parsed.name).toBe("Launch");
    expect(parsed.discountPct).toBe(10);
  });

  it("rejects a percent above 100", () => {
    expect(() =>
      promotionSchema.parse({ isNew: true, name: "Too much", discountPct: 150 }),
    ).toThrow();
  });

  it("rejects an empty name", () => {
    expect(() =>
      promotionSchema.parse({ isNew: true, name: "", discountPct: 5 }),
    ).toThrow();
  });
});
