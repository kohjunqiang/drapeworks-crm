import { describe, expect, it } from "vitest";

import { halfDepositCents } from "./payment-defaults";

describe("halfDepositCents", () => {
  it("defaults a deposit to exactly half of an even-cent quote", () => {
    expect(halfDepositCents(256_700)).toBe(128_350);
  });

  it("rounds an odd half-cent to the nearest payable cent", () => {
    expect(halfDepositCents(256_701)).toBe(128_351);
  });
});
