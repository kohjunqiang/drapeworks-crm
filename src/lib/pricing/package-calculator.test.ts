import { describe, expect, it } from "vitest";

import { computePackageQuote } from "./package-calculator";

describe("computePackageQuote", () => {
  it("adds whole-package, per-room and measured upgrades after the base", () => {
    const quote = computePackageQuote("4-room Essential Groupbuy", 76_800, [
      {
        key: "pls",
        label: "Performance / Luxe / Signature",
        direction: "charge",
        basis: "whole_package",
        amountSgdCents: 30_000,
      },
      {
        key: "ultimate",
        label: "Ultimate from P/L/S",
        direction: "charge",
        basis: "per_room",
        amountSgdCents: 10_000,
        roomCount: 1,
      },
      {
        key: "blackout",
        label: "Blackout",
        direction: "charge",
        basis: "per_metre",
        amountSgdCents: 5_000,
        widthCm: 320,
      },
    ]);

    expect(quote.totalSgdCents).toBe(132_800);
    expect(quote.lines.map((line) => line.totalSgdCents)).toEqual([
      76_800,
      30_000,
      10_000,
      16_000,
    ]);
  });

  it("subtracts a configured downgrade without changing other lines", () => {
    const quote = computePackageQuote("Essential", 76_800, [
      {
        key: "remove_day",
        label: "Remove Day",
        direction: "credit",
        basis: "per_room",
        amountSgdCents: 5_000,
        roomCount: 1,
      },
    ]);
    expect(quote.totalSgdCents).toBe(71_800);
  });

  it("rejects credits that would turn a package negative", () => {
    expect(() =>
      computePackageQuote("Essential", 5_000, [
        {
          key: "credit",
          label: "Credit",
          direction: "credit",
          basis: "whole_package",
          amountSgdCents: 6_000,
        },
      ]),
    ).toThrow("credits cannot exceed");
  });

  it("rejects fractional room counts", () => {
    expect(() =>
      computePackageQuote("Essential", 10_000, [
        {
          key: "ultimate",
          label: "Ultimate",
          direction: "charge",
          basis: "per_room",
          amountSgdCents: 10_000,
          roomCount: 1.5,
        },
      ]),
    ).toThrow("room count");
  });

  it("rejects missing quantities instead of silently charging zero", () => {
    expect(() =>
      computePackageQuote("Essential", 10_000, [
        {
          key: "blackout",
          label: "Blackout",
          direction: "charge",
          basis: "per_metre",
          amountSgdCents: 5_000,
        },
      ]),
    ).toThrow("requires a measured width");
  });
});
