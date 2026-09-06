import { describe, expect, it } from "vitest";

import { defaultCustomerMessage, isGeneratedCustomerMessage, quotationDateOnly, quotationTotalCents, toZohoEstimatePayload } from "./model";
import { quotePayloadHash } from "./hash";

describe("quotation model", () => {
  it("formats database date values for HTML date inputs", () => {
    expect(quotationDateOnly(new Date("2026-09-03T00:00:00.000Z"))).toBe("2026-09-03");
    expect(quotationDateOnly("2026-09-10")).toBe("2026-09-10");
  });
  it("totals fractional quantities and line discounts in cents", () => {
    expect(quotationTotalCents([{ zohoItemId: null, name: "Track", description: "", quantity: 2.5, rateCents: 1000, discountPercent: 10 }])).toBe(2250);
  });

  it("hashes object keys canonically", () => {
    expect(quotePayloadHash({ b: 2, a: 1 })).toBe(quotePayloadHash({ a: 1, b: 2 }));
  });

  it("maps catalogue and custom lines into a complete Zoho payload", () => {
    const payload = toZohoEstimatePayload({ contactId: "c1", referenceNumber: "DW-1 / Q1", issueDate: "2026-09-03", expiryDate: "2026-09-10", notes: "n", terms: "t", salespersonName: null, templateId: "tpl", lines: [
      { zohoItemId: "item1", name: "Catalogue", description: "A", quantity: 1, rateCents: 12345, discountPercent: 0 },
      { zohoItemId: null, name: "Custom", description: "B", quantity: 2, rateCents: 500, discountPercent: 5 },
    ] });
    expect(payload.line_items).toEqual([
      { item_id: "item1", description: "A", quantity: 1, rate: 123.45, discount: 0 },
      { name: "Custom", description: "B", quantity: 2, rate: 5, discount: 5 },
    ]);
  });

  it("builds copy text from the exact total", () => {
    expect(defaultCustomerMessage({ customerName: "Jamie Tan", displayId: "DW-1", totalCents: 120000, expiryDate: "2026-09-10" })).toContain("$1,200.00");
  });

  it("recognizes generated messages from before or after Zoho assigns a quote number", () => {
    const input = { customerName: "Jamie Tan", totalCents: 120000, expiryDate: "2026-09-10" };
    const preZoho = defaultCustomerMessage({ ...input, displayId: "DW-1" });

    expect(isGeneratedCustomerMessage(preZoho, input, ["DW-1", "QT-100"])).toBe(true);
    expect(isGeneratedCustomerMessage("A deliberately custom message", input, ["DW-1", "QT-100"])).toBe(false);
  });
});
