import { describe, expect, it } from "vitest";

import { formatFreightAge, normalizeFreightNumber } from "./freight";

describe("normalizeFreightNumber", () => {
  it("trims, compacts whitespace and normalizes case", () => {
    expect(normalizeFreightNumber("  yjd  288a ")).toBe("YJD 288A");
  });
});

describe("formatFreightAge", () => {
  const now = new Date("2026-09-09T12:00:00.000Z");

  it("shows sub-hour, hours and days without false precision", () => {
    expect(formatFreightAge("2026-09-09T11:30:00.000Z", now)).toBe("<1h");
    expect(formatFreightAge("2026-09-08T08:00:00.000Z", now)).toBe("28h");
    expect(formatFreightAge("2026-09-06T10:00:00.000Z", now)).toBe("3d");
  });

  it("returns null when no assignment time exists", () => {
    expect(formatFreightAge(null, now)).toBeNull();
  });
});
