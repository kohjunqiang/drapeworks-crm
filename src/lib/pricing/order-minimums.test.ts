import { describe, expect, it } from "vitest";

import {
  blindMinimumSgdCents,
  meshCategoryMinimumSgdCents,
} from "./order-minimums";

describe("pricing minimum classification", () => {
  it("recognises Venetian series names", () => {
    expect(blindMinimumSgdCents("Venetian Blinds")).toBe(30_000);
    expect(blindMinimumSgdCents("Korean Combi")).toBe(0);
  });

  it.each([
    ["AirGuard", 55_000],
    ["AirGuard 2-in-1", 55_000],
    ["HomeGuard", 60_000],
    ["HomeGuard & 2 in 1", 60_000],
    ["MaxGuard", 65_000],
  ])("maps %s to its order minimum", (name, expected) => {
    expect(meshCategoryMinimumSgdCents(name)).toBe(expected);
  });
});
