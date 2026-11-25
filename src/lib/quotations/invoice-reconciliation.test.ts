import { describe, expect, it } from "vitest";
import type { ZohoEstimate, ZohoInvoice } from "@/lib/zoho/books";
import { invoiceReconciliationIssues, optionalMoneyCents, invoiceFingerprint, orderReconciliationFingerprint } from "./invoice-reconciliation";
const lines = [{ name: "Curtain", quantity: 1, rate: 100, discount: "0%" }];
const estimate: ZohoEstimate = { estimate_id: "e", estimate_number: "QT-1", customer_id: "c", currency_code: "SGD", status: "invoiced", date: "2026-11-01", total: 100, invoice_ids: ["i"], line_items: lines };
const invoice: ZohoInvoice = { invoice_id: "i", invoice_number: "INV-1", customer_id: "c", currency_code: "SGD", status: "paid", total: 100, line_items: lines };
describe("invoice reconciliation", () => {
 it("accepts the existing paid invoice without needing payment facts", () => expect(invoiceReconciliationIssues(estimate, invoice, "i")).toEqual([]));
 it.each([{ invoice_id: "other" }, { customer_id: "other" }, { currency_code: "USD" }, { status: "void" }, { total: 101 }, { line_items: undefined }, { line_items: [{ ...lines[0], name: "Other" }] }, { shipping_charge: 1 }])("rejects incompatible invoice %j", patch => expect(invoiceReconciliationIssues(estimate, { ...invoice, ...patch }, null).length).toBeGreaterThan(0));
 it("cannot replace an existing local invoice", () => expect(invoiceReconciliationIssues(estimate, invoice, "different").join()).toContain("different invoice"));
 it.each([[[]], [["i", "j"]]])("requires one authoritative link %j", invoice_ids => expect(invoiceReconciliationIssues({ ...estimate, invoice_ids }, invoice, null).length).toBeGreaterThan(0));
 it("rejects reversed dates", () => expect(invoiceReconciliationIssues({ ...estimate, expiry_date: "2026-10-01" }, invoice, null).join()).toContain("expiry"));
 it.each([undefined, null, "", NaN, -1])("keeps unknown payment facts unknown (%s)", value => expect(optionalMoneyCents(value)).toBeNull());
 it("keeps explicit zero and binds changed payment/order snapshots", () => {
  expect(optionalMoneyCents(0)).toBe(0);
  expect(invoiceFingerprint(invoice)).not.toBe(invoiceFingerprint({ ...invoice, payment_made: 100 }));
  const order = { current_status: "deposit_received", price_quoted_cents: 10000, deposit_cents: 5000 };
  for (const patch of [{ current_status: "sent_to_vendor" }, { price_quoted_cents: 20000 }, { deposit_cents: 6000 }]) expect(orderReconciliationFingerprint(order)).not.toBe(orderReconciliationFingerprint({ ...order, ...patch }));
 });
});
