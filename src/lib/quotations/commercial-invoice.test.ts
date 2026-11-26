import { describe, expect, it } from "vitest";
import { commercialEqual, commercialUpdateLines, commercialFromQuotation, exactCents, invoiceUpdateIssues, normalizeCommercialInvoice } from "./commercial-invoice";
import type { ZohoInvoice } from "@/lib/zoho/books";
const line = { item_id: "a", name: "Curtain", description: "Room", quantity: 2, rate: 50, discount: "0%" };
const invoice: ZohoInvoice = { invoice_id: "i", total: 100, line_items: [line] };
describe("commercial invoice authority", () => {
  it("preserves signed waiver lines and detects same-total item changes", () => {
    const value = { invoice_id: "i", total: 4730, line_items: [{ name: "Curtains", quantity: 1, rate: 4730 }, { name: "Installation", quantity: 23, rate: 10 }, { name: "Installation waiver", quantity: 1, rate: -230, item_total: -230 }] };
    const document = normalizeCommercialInvoice(value);
    expect(document.lines.map(line => line.totalCents)).toEqual([473000, 23000, -23000]);
    expect(commercialEqual(document, normalizeCommercialInvoice({ ...value, line_items: value.line_items.map(line => ({ ...line, name: line.name + " changed" })) }))).toBe(false);
  });
  it("rounds signed half cents symmetrically and rejects positive-item overdiscount", () => {
    expect(normalizeCommercialInvoice({ invoice_id: "i", total: 0.98, line_items: [{ name: "Base", quantity: 1, rate: 1 }, { name: "Waiver", quantity: 0.5, rate: -0.03, item_total: -0.02 }] }).lines[1].totalCents).toBe(-2);
    expect(() => normalizeCommercialInvoice({ invoice_id: "i", total: 99, line_items: [{ name: "Base", quantity: 1, rate: 100 }, { name: "Invalid", quantity: 1, rate: 1, discount: 2 }] })).toThrow();
  });
  it("compares order-insensitively while preserving duplicate multiplicity", () => {
    const a = { ...line, name: "A" }, b = { ...line, name: "B" };
    expect(commercialEqual(normalizeCommercialInvoice({ ...invoice, total: 200, line_items: [a, b] }), normalizeCommercialInvoice({ ...invoice, total: 200, line_items: [b, a] }))).toBe(true);
    expect(commercialEqual(normalizeCommercialInvoice({ ...invoice, total: 200, line_items: [a, a] }), normalizeCommercialInvoice({ ...invoice, total: 200, line_items: [a, b] }))).toBe(false);
  });
  it.each([{ name: "Other" }, { description: "Other" }, { item_id: "other" }, { quantity: 1, rate: 100 }])("same total different items mismatch %j", patch => {
    expect(commercialEqual(normalizeCommercialInvoice(invoice), normalizeCommercialInvoice({ ...invoice, line_items: [{ ...line, ...patch }] }))).toBe(false);
  });
  it("normalizes effective percent versus flat discount and fractional quantities", () => {
    const a = normalizeCommercialInvoice({ ...invoice, total: 45, line_items: [{ ...line, quantity: 0.5, rate: 100, discount: "10%" }] });
    const b = normalizeCommercialInvoice({ ...invoice, total: 45, line_items: [{ ...line, quantity: 0.5, rate: 100, discount: 5 }] });
    expect(commercialEqual(a, b)).toBe(true);
  });
  it("preserves and compares tax breakdown, shipping, negative adjustment and document discount", () => {
    const value = normalizeCommercialInvoice({ ...invoice, total: 104, tax_total: 9, taxes: [{ tax_id: "GST", tax_name: "GST", tax_percentage: 9, tax_amount: 9 }], shipping_charge: 10, adjustment: -5, discount: 10, line_items: [{ ...line, tax_id: "GST", tax_percentage: 9 }] });
    expect(value).toMatchObject({ totalCents: 10400, taxCents: 900, shippingCents: 1000, adjustmentCents: -500, documentDiscountCents: 1000 });
    expect(value.lines[0].taxId).toBe("GST");
  });
  it("survives JSONB object key reordering without losing equality", () => {
    const document = normalizeCommercialInvoice(invoice);
    const reordered = { ...document, lines: document.lines.map(line => Object.fromEntries(Object.entries(line).reverse())) } as typeof document;
    expect(commercialEqual(document, reordered)).toBe(true);
  });
  it("preserves percent semantics through the three-cent rounding boundary", () => {
    const document = normalizeCommercialInvoice({ invoice_id: "i", total: 0.02, line_items: [{ name: "Tiny", quantity: 1, rate: 0.03, discount: "50%" }] });
    const payload = commercialUpdateLines(document);
    expect(payload[0].discount).toBe("50%");
    expect(commercialEqual(document, normalizeCommercialInvoice({ invoice_id: "i", total: 0.02, line_items: payload }))).toBe(true);
  });
  it("initial quote basis and zero-tax invoice compare equal", () => {
    expect(commercialEqual(commercialFromQuotation([{ zohoItemId: "a", name: "Curtain", description: "Room", quantity: 2, rateCents: 5000, discountPercent: 0 }], 10000), normalizeCommercialInvoice(invoice))).toBe(true);
  });
  it.each([undefined, null, NaN, "100.001", "1e2", "-2"])('rejects missing/malformed/sub-cent money %s', value => expect(() => exactCents(value)).toThrow());
  it.each([{ line_items: undefined }, { tax_total: 1 }, { total: 99 }, { is_inclusive_tax: true }, { line_items: [{ ...line, item_total: 99 }] }])("does not claim equality for unverifiable financials %j", patch => expect(() => normalizeCommercialInvoice({ ...invoice, ...patch })).toThrow());
  const unpaid = { ...invoice, status: "sent", balance: 100, payment_made: 0, credits_applied: 0, write_off_amount: 0, ach_payment_initiated: false };
  it("permits documented verified unpaid fields without inventing a retainer field", () => expect(invoiceUpdateIssues(unpaid)).toEqual([]));
  it.each([{ status: "paid" }, { payment_made: 1 }, { credits_applied: 1 }, { write_off_amount: undefined }, { ach_payment_initiated: true }, { tax_amount_withheld: 1 }, { balance: undefined }])("blocks unsafe update %j", patch => expect(invoiceUpdateIssues({ ...unpaid, ...patch }).length).toBeGreaterThan(0));
});
