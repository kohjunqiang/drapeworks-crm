import { describe, expect, it } from "vitest";

import { formatSGD } from "./money";

describe("formatSGD", () => {
  it("keeps whole-dollar amounts compact", () => {
    expect(formatSGD(100)).toBe("$1");
  });

  it("does not round away cents", () => {
    expect(formatSGD(50)).toBe("$0.50");
    expect(formatSGD(150)).toBe("$1.50");
  });
});
