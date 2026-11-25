import { describe, expect, it } from "vitest";
import type { ZohoEstimate, ZohoInvoice } from "@/lib/zoho/books";
import { invoiceFinancialDifferences, invoiceReconciliationIssues, optionalMoneyCents, invoiceFingerprint, orderReconciliationFingerprint } from "./invoice-reconciliation";
const lines = [{ name: "Curtain", quantity: 1, rate: 100, discount: "0%" }];
const estimate: ZohoEstimate = { estimate_id: "e", estimate_number: "QT-1", customer_id: "c", currency_code: "SGD", status: "invoiced", date: "2026-11-01", total: 100, invoice_ids: ["i"], line_items: lines };
const invoice: ZohoInvoice = { invoice_id: "i", invoice_number: "INV-1", customer_id: "c", currency_code: "SGD", status: "paid", total: 100, line_items: lines };
describe("invoice reconciliation", () => {
 it("accepts the existing paid invoice without needing payment facts", () => expect(invoiceReconciliationIssues(estimate, invoice, "i")).toEqual([]));
 it.each([{ invoice_id: "other" }, { customer_id: "other" }, { currency_code: "USD" }, { status: "void" }, { total: undefined }, { total: null as unknown as number }, { total: NaN }, { total: -1 }])("rejects an unusable invoice %j", patch => expect(invoiceReconciliationIssues(estimate, { ...invoice, ...patch }, null).length).toBeGreaterThan(0));
 it("does not require the invoice to be CRM-representable", () => {
   expect(invoiceReconciliationIssues(estimate, { ...invoice, line_items: undefined }, null)).toEqual([]);
   expect(invoiceReconciliationIssues(estimate, { ...invoice, shipping_charge: 1 }, null)).toEqual([]);
   expect(invoiceReconciliationIssues(estimate, { ...invoice, line_items: [{ name: "Flat", quantity: 1, rate: 120, discount: 20 }] }, null)).toEqual([]);
 });
 it("cannot replace an existing local invoice", () => expect(invoiceReconciliationIssues(estimate, invoice, "different").join()).toContain("different invoice"));
 it.each([[[]], [["i", "j"]]])("requires one authoritative link %j", invoice_ids => expect(invoiceReconciliationIssues({ ...estimate, invoice_ids }, invoice, null).length).toBeGreaterThan(0));
 it("rejects reversed dates", () => expect(invoiceReconciliationIssues({ ...estimate, expiry_date: "2026-10-01" }, invoice, null).join()).toContain("expiry"));
 it("still rejects a quotation that is not a valid CRM snapshot", () => {
   expect(invoiceReconciliationIssues({ ...estimate, total: 120 }, invoice, null).join()).toContain("do not add up");
   expect(invoiceReconciliationIssues({ ...estimate, line_items: [{ name: "Curtain", quantity: 1, rate: 100, discount: 20 }] }, invoice, null).length).toBeGreaterThan(0);
 });
 it.each([undefined, null, "", NaN, -1])("keeps unknown payment facts unknown (%s)", value => expect(optionalMoneyCents(value)).toBeNull());
 it("keeps explicit zero and binds changed payment/order snapshots", () => {
  expect(optionalMoneyCents(0)).toBe(0);
  expect(invoiceFingerprint(invoice)).not.toBe(invoiceFingerprint({ ...invoice, payment_made: 100 }));
  const order = { current_status: "deposit_received", price_quoted_cents: 10000, deposit_cents: 5000 };
  for (const patch of [{ current_status: "sent_to_vendor" }, { price_quoted_cents: 20000 }, { deposit_cents: 6000 }]) expect(orderReconciliationFingerprint(order)).not.toBe(orderReconciliationFingerprint({ ...order, ...patch }));
 });
});
describe("invoice financial differences", () => {
 it("reports nothing when quotation, invoice and order agree", () => expect(invoiceFinancialDifferences(estimate, invoice, 10000)).toEqual([]));
 it("reports the exact quote/invoice/order totals on the real 4390/4730 mismatch", () => {
   const quote = { ...estimate, total: 4390, line_items: [{ name: "Curtain", quantity: 1, rate: 4390, discount: "0%" }] };
   const bill = { ...invoice, total: 4730, payment_made: 2365, balance: 2365, line_items: [{ name: "Curtain", quantity: 1, rate: 4730 }] };
   const differences = invoiceFinancialDifferences(quote, bill, 473000);
   expect(differences).toHaveLength(2);
   expect(differences[0]).toContain("S$4,730.00");
   expect(differences[0]).toContain("S$4,390.00");
   expect(differences[1]).toContain("S$4,730.00");
   expect(differences[1]).toContain("S$4,390.00");
 });
 it("lists line differences when the totals still match", () => {
   const differences = invoiceFinancialDifferences(estimate, { ...invoice, line_items: [{ name: "Other", quantity: 2, rate: 50 }] }, 10000);
   expect(differences).toHaveLength(1);
   expect(differences[0]).toContain("lines differ");
   expect(differences[0]).toContain("Other");
 });
 it("explains invoice lines that cannot be compared instead of treating them as matching", () => {
   expect(invoiceFinancialDifferences(estimate, { ...invoice, line_items: undefined }, 10000).join()).toContain("could not be verified");
   expect(invoiceFinancialDifferences(estimate, { ...invoice, line_items: [{ name: "Odd", quantity: 1, rate: 100, discount: "later" }] }, 10000).join()).toContain("could not be verified");
 });
 it("warns on offsetting header components even when totals and lines match", () => {
   const differences = invoiceFinancialDifferences(estimate, { ...invoice, tax_total: 10, adjustment: -10 }, 10000);
   expect(differences).toHaveLength(2);
   expect(differences[0]).toContain("tax total differs");
   expect(differences[0]).toContain("S$10.00");
   expect(differences[1]).toContain("adjustment differs");
   expect(differences[1]).toContain("S$-10.00");
 });
 it("warns on a differing or unverifiable header component, treating missing and zero alike", () => {
   expect(invoiceFinancialDifferences(estimate, { ...invoice, shipping_charge: 5 }, 10000).join()).toContain("shipping charge differs");
   expect(invoiceFinancialDifferences(estimate, { ...invoice, tax_total: NaN }, 10000).join()).toContain("tax total could not be verified");
   expect(invoiceFinancialDifferences(estimate, { ...invoice, discount: "10%" }, 10000).join()).toContain("document-level discount differs");
   expect(invoiceFinancialDifferences({ ...estimate, tax_total: 0 }, { ...invoice, taxes: [] }, 10000)).toEqual([]);
 });
 it("reports an order total difference even when quote and invoice agree", () => {
   const differences = invoiceFinancialDifferences(estimate, invoice, 20000);
   expect(differences).toHaveLength(1);
   expect(differences[0]).toContain("S$200.00");
   expect(differences[0]).toContain("stay unchanged");
 });
 it("never treats an unreadable total as a match", () => {
   expect(invoiceFinancialDifferences(estimate, { ...invoice, total: undefined }, null).join()).toContain("could not be read");
 });
});
