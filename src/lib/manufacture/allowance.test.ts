import { describe, expect, it } from "vitest";

import {
  applyAllowance,
  isManufacturable,
  type Allowance,
  type AllowanceBook,
  resolveAllowance,
} from "./allowance";

const BOOK: AllowanceBook = {
  curtain: { widthDeltaCm: -2, heightDeltaCm: -4 },
  blind: null,
  mesh: { widthDeltaCm: 0, heightDeltaCm: -1 },
};

describe("resolveAllowance", () => {
  it("returns the configured allowance for a line", () => {
    expect(resolveAllowance(BOOK, "curtain")).toEqual({
      widthDeltaCm: -2,
      heightDeltaCm: -4,
    });
  });

  it("returns null for an unconfigured line", () => {
    expect(resolveAllowance(BOOK, "blind")).toBeNull();
  });

  it("treats a zero allowance as configured, not missing", () => {
    expect(resolveAllowance(BOOK, "mesh")).toEqual({
      widthDeltaCm: 0,
      heightDeltaCm: -1,
    });
  });
});

describe("applyAllowance", () => {
  const curtain: Allowance = { widthDeltaCm: -2, heightDeltaCm: -4 };

  it("subtracts the delta from both dimensions", () => {
    expect(applyAllowance({ widthCm: 300, heightCm: 240 }, curtain)).toEqual({
      sourceWidthCm: 300,
      sourceHeightCm: 240,
      widthDeltaCm: -2,
      heightDeltaCm: -4,
      mfgWidthCm: 298,
      mfgHeightCm: 236,
    });
  });

  it("leaves dimensions untouched on a zero allowance", () => {
    const zero: Allowance = { widthDeltaCm: 0, heightDeltaCm: 0 };
    const out = applyAllowance({ widthCm: 150, heightCm: 200 }, zero);
    expect(out!.mfgWidthCm).toBe(150);
    expect(out!.mfgHeightCm).toBe(200);
  });

  it("returns null when a source dimension is missing", () => {
    expect(applyAllowance({ widthCm: null, heightCm: 240 }, curtain)).toBeNull();
    expect(applyAllowance({ widthCm: 300, heightCm: null }, curtain)).toBeNull();
  });

  it("returns null when a source dimension is not positive", () => {
    expect(applyAllowance({ widthCm: 0, heightCm: 240 }, curtain)).toBeNull();
    expect(applyAllowance({ widthCm: 300, heightCm: -5 }, curtain)).toBeNull();
  });
});

describe("applyAllowance — the allowance can exceed the opening", () => {
  it("reports a non-manufacturable result rather than a negative dimension", () => {
    // A 3cm-wide window minus a 4cm allowance is not something a vendor can
    // build. It must surface as a problem for a human, not as -1.
    const out = applyAllowance(
      { widthCm: 3, heightCm: 240 },
      { widthDeltaCm: -4, heightDeltaCm: -4 },
    );
    expect(out).not.toBeNull();
    expect(out!.mfgWidthCm).toBe(-1);
    expect(isManufacturable(out!)).toBe(false);
  });

  it("accepts a result where both dimensions stay positive", () => {
    const out = applyAllowance(
      { widthCm: 300, heightCm: 240 },
      { widthDeltaCm: -2, heightDeltaCm: -4 },
    );
    expect(isManufacturable(out!)).toBe(true);
  });
});
