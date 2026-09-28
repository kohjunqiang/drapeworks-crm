import { describe, expect, it } from "vitest";

import { defaultCustomerMessage, isGeneratedCustomerMessage, parseRateDraftCents, quotationDateOnly, quotationTotalCents, toLegacyZohoEstimatePayload, toZohoEstimatePayload } from "./model";
import { matchesStoredZohoEstimate, quotePayloadHash } from "./hash";

// The documented Zoho contract: a line discount string ending in "%" is a
// percentage of the line; a bare number is a flat amount off the line.
// Applying it to the serialized payload catches a regression that re-emits
// the discount as a number — 15 would read as SGD 15.00 off, not 15%.
function zohoInterpretedTotalCents(payload: ReturnType<typeof toZohoEstimatePayload>): number {
  return payload.line_items.reduce((sum, line) => {
    const grossCents = Math.round(Number(line.rate) * 100 * Number(line.quantity));
    const discount = line.discount;
    const discounted = typeof discount === "string" && discount.endsWith("%")
      ? grossCents * (1 - Number.parseFloat(discount) / 100)
      : grossCents - Number(discount) * 100;
    return sum + Math.round(discounted);
  }, 0);
}

const payloadInput = (lines: Parameters<typeof toZohoEstimatePayload>[0]["lines"]) => ({
  contactId: "c1", referenceNumber: "DW-1 / Q1", issueDate: "2026-09-03", expiryDate: "2026-09-10",
  notes: "n", terms: "t", salespersonName: null, templateId: "tpl", lines,
});

describe("quotation model", () => {
  it("formats database date values for HTML date inputs", () => {
    expect(quotationDateOnly(new Date("2026-09-03T00:00:00.000Z"))).toBe("2026-09-03");
    expect(quotationDateOnly("2026-09-10")).toBe("2026-09-10");
  });
  it("totals fractional quantities and line discounts in cents", () => {
    expect(quotationTotalCents([{ zohoItemId: null, name: "Track", description: "", quantity: 2.5, rateCents: 1000, discountPercent: 10 }])).toBe(2250);
  });

  it("parses signed decimal rate drafts into integer cents", () => {
    expect(parseRateDraftCents("-100")).toBe(-10000);
    expect(parseRateDraftCents("-0.5")).toBe(-50);
    expect(parseRateDraftCents("12.345")).toBe(1235);
    expect(parseRateDraftCents("30.5")).toBe(3050);
    expect(parseRateDraftCents("0.01")).toBe(1);
    expect(parseRateDraftCents("-0.005")).toBe(0);
  });

  it("leaves incomplete or non-decimal rate drafts unparsed", () => {
    expect(parseRateDraftCents("")).toBeNull();
    expect(parseRateDraftCents("-")).toBeNull();
    expect(parseRateDraftCents("-1.")).toBeNull();
    expect(parseRateDraftCents("abc")).toBeNull();
  });

  it("does not accept exponent notation in rate drafts", () => {
    expect(parseRateDraftCents("1e3")).toBeNull();
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
      { item_id: "item1", description: "A", quantity: 1, rate: 123.45, discount: "0%" },
      { name: "Custom", description: "B", quantity: 2, rate: 5, discount: "5%" },
    ]);
  });

  // Reported bug: rate SGD 6150.00 x 1 at 15% must bill SGD 5227.50. Zoho
  // reads a bare numeric 15 as a flat SGD 15.00 discount (SGD 6135.00), which
  // is what the remote-total guard rejected.
  it("serializes a 15% line discount as a percentage string Zoho totals at 5227.50", () => {
    const lines = [{ zohoItemId: null, name: "Curtains", description: "", quantity: 1, rateCents: 615_000, discountPercent: 15 }];
    const payload = toZohoEstimatePayload(payloadInput(lines));
    expect(payload.line_items[0].discount).toBe("15%");
    expect(zohoInterpretedTotalCents(payload)).toBe(522_750);
    expect(zohoInterpretedTotalCents(payload)).toBe(quotationTotalCents(lines));
  });

  it.each([
    [0, "0%"],
    [12.5, "12.5%"],
    [100, "100%"],
  ])("serializes %i%% as the percentage string %s", (discountPercent, expected) => {
    const lines = [{ zohoItemId: null, name: "Line", description: "", quantity: 1, rateCents: 615_000, discountPercent }];
    const payload = toZohoEstimatePayload(payloadInput(lines));
    expect(payload.line_items[0].discount).toBe(expected);
    expect(zohoInterpretedTotalCents(payload)).toBe(quotationTotalCents(lines));
  });

  it("keeps Zoho-interpreted totals equal to the CRM total for fractional quantities and multiple lines", () => {
    const lines = [
      { zohoItemId: null, name: "Track", description: "", quantity: 2.5, rateCents: 100_000, discountPercent: 10 },
      { zohoItemId: null, name: "Sheer", description: "", quantity: 1, rateCents: 615_000, discountPercent: 15 },
    ];
    const payload = toZohoEstimatePayload(payloadInput(lines));
    expect(payload.line_items.map((line) => line.discount)).toEqual(["10%", "15%"]);
    expect(zohoInterpretedTotalCents(payload)).toBe(quotationTotalCents(lines));
    expect(zohoInterpretedTotalCents(payload)).toBe(747_750);
  });

  it("keeps the legacy reconstruction on the historical bare-number discount", () => {
    const payload = toLegacyZohoEstimatePayload(payloadInput([
      { zohoItemId: null, name: "Curtains", description: "", quantity: 1, rateCents: 615_000, discountPercent: 15 },
    ]));
    expect(payload.line_items[0].discount).toBe(15);
  });

  it("builds copy text from the exact total", () => {
    expect(defaultCustomerMessage({ customerName: "Jamie Tan", displayId: "DW-1", totalCents: 120000, expiryDate: "2026-09-10" })).toContain("$1,200.00");
  });

  it("omits the validity clause when the quotation has no expiry", () => {
    const message = defaultCustomerMessage({ customerName: "Jamie Tan", displayId: "QT-677815", totalCents: 120000, expiryDate: null });
    expect(message).toContain("QT-677815");
    expect(message).toContain("$1,200.00");
    expect(message).not.toContain("valid until");
  });

  it("omits expiry_date from the Zoho payload when there is no expiry", () => {
    const payload = toZohoEstimatePayload({ contactId: "c1", referenceNumber: "DW-1 / Q1", issueDate: "2026-09-03", expiryDate: null, notes: "n", terms: "t", salespersonName: null, templateId: "tpl", lines: [
      { zohoItemId: null, name: "Custom", description: "B", quantity: 1, rateCents: 500, discountPercent: 0 },
    ] });
    expect(payload).not.toHaveProperty("expiry_date");
  });

  it("keeps expiry_date in the Zoho payload when set", () => {
    const payload = toZohoEstimatePayload({ contactId: "c1", referenceNumber: "DW-1 / Q1", issueDate: "2026-09-03", expiryDate: "2026-09-10", notes: "n", terms: "t", salespersonName: null, templateId: "tpl", lines: [
      { zohoItemId: null, name: "Custom", description: "B", quantity: 1, rateCents: 500, discountPercent: 0 },
    ] });
    expect("expiry_date" in payload ? payload.expiry_date : undefined).toBe("2026-09-10");
  });

  it("passes a null database expiry through as null", () => {
    expect(quotationDateOnly(null)).toBeNull();
  });

  it("recognizes generated messages from before or after Zoho assigns a quote number", () => {
    const input = { customerName: "Jamie Tan", totalCents: 120000, expiryDate: "2026-09-10" };
    const preZoho = defaultCustomerMessage({ ...input, displayId: "DW-1" });

    expect(isGeneratedCustomerMessage(preZoho, input, ["DW-1", "QT-100"])).toBe(true);
    expect(isGeneratedCustomerMessage("A deliberately custom message", input, ["DW-1", "QT-100"])).toBe(false);
  });
});

describe("matchesStoredZohoEstimate", () => {
  const matching = {
    remoteKey: null,
    expectedKey: "crm-key",
    remoteCustomerId: "customer",
    expectedCustomerId: "customer",
    remoteCurrency: "SGD",
    remoteTotalCents: 150_000,
    expectedTotalCents: 150_000,
    remoteStatus: "sent",
    remoteSnapshotHash: "snapshot",
    storedSnapshotHash: "snapshot",
  };

  it("accepts an imported Zoho quotation without a CRM key when its snapshot matches", () => {
    expect(matchesStoredZohoEstimate(matching)).toBe(true);
  });

  it("rejects a conflicting CRM key", () => {
    expect(matchesStoredZohoEstimate({ ...matching, remoteKey: "another-key" })).toBe(false);
  });

  it.each([
    { remoteCustomerId: "another-customer" },
    { remoteCurrency: "USD" },
    { remoteTotalCents: 149_999 },
    { remoteStatus: "draft" },
    { remoteSnapshotHash: "changed" },
    { storedSnapshotHash: null },
  ])("rejects a changed or incomplete estimate: %o", (change) => {
    expect(matchesStoredZohoEstimate({ ...matching, ...change })).toBe(false);
  });
});
