import { describe, expect, it } from "vitest";

import { nextPoNumber } from "./number";

describe("nextPoNumber", () => {
  it("starts at the agreed next number", () => {
    expect(nextPoNumber([])).toBe("10052");
  });

  it("increments the greatest saved numeric reference", () => {
    expect(nextPoNumber(["10051", "10054", "10053"])).toBe("10055");
  });

  it("ignores display-style and blank references", () => {
    expect(nextPoNumber([null, "", "DW-2026-0017", " 10052 "])).toBe(
      "10053",
    );
  });
});
