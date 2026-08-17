import { describe, expect, it } from "vitest";

import { allowanceSchema } from "./manufacture";

describe("allowanceSchema", () => {
  it("accepts a negative delta pair", () => {
    expect(
      allowanceSchema.parse({
        productLine: "curtain",
        widthDeltaCm: -2,
        heightDeltaCm: -4,
      }),
    ).toEqual({ productLine: "curtain", widthDeltaCm: -2, heightDeltaCm: -4 });
  });

  it("accepts zero", () => {
    const out = allowanceSchema.parse({
      productLine: "mesh",
      widthDeltaCm: 0,
      heightDeltaCm: 0,
    });
    expect(out.widthDeltaCm).toBe(0);
  });

  it("accepts a positive delta, since the sign is meaningful", () => {
    const out = allowanceSchema.parse({
      productLine: "blind",
      widthDeltaCm: 1,
      heightDeltaCm: 2,
    });
    expect(out.widthDeltaCm).toBe(1);
  });

  it("rejects an unknown product line", () => {
    expect(() =>
      allowanceSchema.parse({
        productLine: "awning",
        widthDeltaCm: 0,
        heightDeltaCm: 0,
      }),
    ).toThrow();
  });

  it("rejects a non-integer delta", () => {
    expect(() =>
      allowanceSchema.parse({
        productLine: "curtain",
        widthDeltaCm: -2.5,
        heightDeltaCm: -4,
      }),
    ).toThrow();
  });

  // The bound is inclusive. Pinning both sides of it means an off-by-one —
  // ±99 or ±101 — fails here rather than at a vendor's cutting table.
  it("accepts a delta exactly on the bound", () => {
    expect(
      allowanceSchema.parse({
        productLine: "curtain",
        widthDeltaCm: -100,
        heightDeltaCm: 100,
      }).widthDeltaCm,
    ).toBe(-100);
  });

  it("rejects a delta one past the bound", () => {
    expect(() =>
      allowanceSchema.parse({
        productLine: "curtain",
        widthDeltaCm: -101,
        heightDeltaCm: 0,
      }),
    ).toThrow();
    expect(() =>
      allowanceSchema.parse({
        productLine: "curtain",
        widthDeltaCm: 0,
        heightDeltaCm: 101,
      }),
    ).toThrow();
  });

  it("rejects an implausibly large delta", () => {
    expect(() =>
      allowanceSchema.parse({
        productLine: "curtain",
        widthDeltaCm: -500,
        heightDeltaCm: -4,
      }),
    ).toThrow();
  });
});
