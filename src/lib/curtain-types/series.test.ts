import { describe, expect, it } from "vitest";

import { formatCurtainOptionLabel, nextSeriesIndex } from "./series";

describe("nextSeriesIndex", () => {
  it("starts at 1 for an empty series", () => {
    expect(nextSeriesIndex([])).toBe(1);
  });

  it("returns max + 1 regardless of order", () => {
    expect(nextSeriesIndex([1, 2, 3])).toBe(4);
    expect(nextSeriesIndex([3, 1, 2])).toBe(4);
  });

  it("uses max + 1, not count + 1 (does not backfill gaps)", () => {
    expect(nextSeriesIndex([1, 4])).toBe(5);
    expect(nextSeriesIndex([2])).toBe(3);
  });
});

describe("formatCurtainOptionLabel", () => {
  it("renders series, index and page in front of the label", () => {
    expect(
      formatCurtainOptionLabel({
        series: "Alfa",
        index: 12,
        page: "P30",
        label: "Sheer Ivory",
      }),
    ).toBe("Alfa #12 · P30 — Sheer Ivory");
  });

  it("omits a missing page", () => {
    expect(
      formatCurtainOptionLabel({
        series: "Alfa",
        index: 12,
        page: null,
        label: "Sheer Ivory",
      }),
    ).toBe("Alfa #12 — Sheer Ivory");
  });

  it("shows the series alone when there's no index", () => {
    expect(
      formatCurtainOptionLabel({
        series: "Alfa",
        index: null,
        page: null,
        label: "X",
      }),
    ).toBe("Alfa — X");
  });

  it("falls back to just the label when there's no metadata", () => {
    expect(
      formatCurtainOptionLabel({
        series: null,
        index: null,
        page: null,
        label: "X",
      }),
    ).toBe("X");
  });
});
