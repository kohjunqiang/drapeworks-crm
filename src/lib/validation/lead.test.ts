import { describe, expect, it } from "vitest";

import { leadCreateSchema } from "./lead";

const base = {
  name: "Mindy",
  funnel_stage: "New Lead",
  lead_status: "Active",
};

function parseQuote(value: unknown) {
  return leadCreateSchema.parse({ ...base, latest_quote_sgd: value })
    .latest_quote_sgd;
}

describe("leadCreateSchema", () => {
  it("accepts the minimum a lead needs", () => {
    const parsed = leadCreateSchema.parse(base);
    expect(parsed.name).toBe("Mindy");
    expect(parsed.funnel_stage).toBe("New Lead");
    expect(parsed.lead_status).toBe("Active");
  });

  it("rejects an unknown funnel stage", () => {
    expect(() =>
      leadCreateSchema.parse({ ...base, funnel_stage: "Almost Won" }),
    ).toThrow();
  });

  describe("latest_quote_sgd", () => {
    // The bug this pins: z.coerce.number() alone turns "" into 0, because
    // Number("") === 0. An untouched number input would then write a phantom
    // S$0.00 quote onto a lead nobody has quoted.
    it("treats an empty string as absent, not zero", () => {
      expect(parseQuote("")).toBeUndefined();
    });

    it("treats a whitespace-only string as absent, not zero", () => {
      expect(parseQuote("   ")).toBeUndefined();
    });

    it("treats an absent field as absent", () => {
      expect(leadCreateSchema.parse(base).latest_quote_sgd).toBeUndefined();
    });

    it("treats null as absent, not zero", () => {
      expect(parseQuote(null)).toBeUndefined();
    });

    // The case that makes the fix non-trivial: a genuine zero is a real
    // quote value and must not be swallowed along with the empty string.
    it("preserves a typed zero", () => {
      expect(parseQuote("0")).toBe(0);
    });

    it("coerces a numeric string to a number", () => {
      expect(parseQuote("1600")).toBe(1600);
    });

    it("accepts a number as-is", () => {
      expect(parseQuote(1600)).toBe(1600);
    });

    it("rejects a negative quote", () => {
      expect(() => parseQuote("-1")).toThrow();
    });

    it("rejects a quote above the cap", () => {
      expect(() => parseQuote("1000001")).toThrow();
    });
  });
});
