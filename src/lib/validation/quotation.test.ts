import { describe, expect, it } from "vitest";

import { saveQuotationSchema } from "./quotation";

const base = {
  orderId: "a31fd642-0fe2-4066-9762-880b0e023471",
  quotationId: null,
  expectedUpdatedAt: null,
  issueDate: "2026-09-19",
  expiryDate: "2026-09-26",
  lines: [
    { zohoItemId: null, name: "Curtains and blinds", description: "", quantity: 1, rateCents: 120_000, discountPercent: 0 },
  ],
  customerMessage: "Hi there",
  notes: "",
  terms: "",
};

describe("saveQuotationSchema expiry date", () => {
  it("normalises a blank expiry from the form to null", () => {
    expect(saveQuotationSchema.parse({ ...base, expiryDate: "" }).expiryDate).toBeNull();
  });

  it("accepts an explicit null or missing expiry", () => {
    expect(saveQuotationSchema.parse({ ...base, expiryDate: null }).expiryDate).toBeNull();
    const withoutExpiry: Record<string, unknown> = { ...base };
    delete withoutExpiry.expiryDate;
    expect(saveQuotationSchema.parse(withoutExpiry).expiryDate).toBeNull();
  });

  it("accepts an expiry on or after the issue date", () => {
    expect(saveQuotationSchema.parse(base).expiryDate).toBe("2026-09-26");
    expect(saveQuotationSchema.parse({ ...base, expiryDate: "2026-09-19" }).expiryDate).toBe("2026-09-19");
  });

  it("rejects an expiry before the issue date", () => {
    expect(() => saveQuotationSchema.parse({ ...base, expiryDate: "2026-09-10" })).toThrow(/before the issue date/);
  });

  it("rejects a malformed expiry string", () => {
    expect(() => saveQuotationSchema.parse({ ...base, expiryDate: "soon" })).toThrow();
  });
});
