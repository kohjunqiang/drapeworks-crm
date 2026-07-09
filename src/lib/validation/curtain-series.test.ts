import { describe, expect, it } from "vitest";

import { curtainSeriesSchema } from "./curtain-series";

describe("curtainSeriesSchema", () => {
  it("accepts a new series with a name", () => {
    const parsed = curtainSeriesSchema.parse({ isNew: true, name: "Alfa" });
    expect(parsed.name).toBe("Alfa");
  });

  it("accepts an edit carrying an id", () => {
    const parsed = curtainSeriesSchema.parse({
      isNew: false,
      id: "550e8400-e29b-41d4-a716-446655440000",
      name: "Alfa Renamed",
    });
    expect(parsed.id).toBe("550e8400-e29b-41d4-a716-446655440000");
  });

  it("rejects an empty name", () => {
    expect(() =>
      curtainSeriesSchema.parse({ isNew: true, name: "" }),
    ).toThrow();
  });

  it("rejects a name longer than 120 chars", () => {
    expect(() =>
      curtainSeriesSchema.parse({ isNew: true, name: "x".repeat(121) }),
    ).toThrow();
  });
});
