import { describe, expect, it } from "vitest";

import { poFileName } from "./file-name";

describe("poFileName", () => {
  it("includes the order customer independently of CUST REF", () => {
    expect(poFileName("100151", "Kenny", "day", "Rising")).toBe(
      "PO-100151-Kenny-Day-Rising.pdf",
    );
  });

  it("makes every segment safe for a Content-Disposition filename", () => {
    expect(poFileName("PO / 52", "Kenny Tan", "night", "Rising (SG)")).toBe(
      "PO-PO-52-Kenny-Tan-Night-Rising-SG.pdf",
    );
  });
});
