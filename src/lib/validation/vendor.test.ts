import { describe, expect, it } from "vitest";

import { vendorSchema } from "./vendor";

describe("vendorSchema", () => {
  it("accepts a new vendor with a name", () => {
    const parsed = vendorSchema.parse({ isNew: true, name: "Rising" });
    expect(parsed.name).toBe("Rising");
  });

  it("trims the name", () => {
    const parsed = vendorSchema.parse({ isNew: true, name: "  FengHua " });
    expect(parsed.name).toBe("FengHua");
  });

  it("accepts an edit carrying an id and notes", () => {
    const parsed = vendorSchema.parse({
      isNew: false,
      id: "550e8400-e29b-41d4-a716-446655440000",
      name: "ShunDe",
      notes: "Blinds specialist",
    });
    expect(parsed.id).toBe("550e8400-e29b-41d4-a716-446655440000");
    expect(parsed.notes).toBe("Blinds specialist");
  });

  it("rejects an empty name", () => {
    expect(() => vendorSchema.parse({ isNew: true, name: "" })).toThrow();
  });

  it("rejects a name longer than 120 chars", () => {
    expect(() =>
      vendorSchema.parse({ isNew: true, name: "x".repeat(121) }),
    ).toThrow();
  });
});
