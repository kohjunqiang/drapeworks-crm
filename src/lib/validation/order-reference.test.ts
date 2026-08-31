import { describe, expect, it } from "vitest";

import { orderReferenceSchema } from "./order";

describe("orderReferenceSchema", () => {
  it("preserves manually entered running numbers, including leading zeroes", () => {
    expect(orderReferenceSchema.parse({
      orderId: "550e8400-e29b-41d4-a716-446655440000",
      reference: "0010041",
    }).reference).toBe("0010041");
  });
  it("trims surrounding whitespace", () => {
    const parsed = orderReferenceSchema.parse({
      orderId: "550e8400-e29b-41d4-a716-446655440000",
      reference: "  SJ-2026-118  ",
    });
    expect(parsed.reference).toBe("SJ-2026-118");
  });

  it("treats an empty string as clearing the reference", () => {
    const parsed = orderReferenceSchema.parse({
      orderId: "550e8400-e29b-41d4-a716-446655440000",
      reference: "   ",
    });
    expect(parsed.reference).toBeNull();
  });

  it("accepts an explicit null", () => {
    const parsed = orderReferenceSchema.parse({
      orderId: "550e8400-e29b-41d4-a716-446655440000",
      reference: null,
    });
    expect(parsed.reference).toBeNull();
  });

  it("rejects a reference longer than 64 characters", () => {
    expect(() =>
      orderReferenceSchema.parse({
        orderId: "550e8400-e29b-41d4-a716-446655440000",
        reference: "x".repeat(65),
      }),
    ).toThrow();
  });

  it("rejects a non-uuid order id", () => {
    expect(() =>
      orderReferenceSchema.parse({ orderId: "nope", reference: "A1" }),
    ).toThrow();
  });
});
