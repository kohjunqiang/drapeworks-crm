import type { ZohoEstimate, ZohoInvoice } from "@/lib/zoho/books";
import { quotePayloadHash } from "./hash";
import { stableJson } from "./model";
import { adoptedTotalMatches, zohoAdoptionIssues, zohoValidatedLines } from "./zoho-adoption";

export function hasZohoInvoice(estimate: ZohoEstimate): boolean {
  return estimate.status === "invoiced" || Boolean(estimate.invoice_ids?.length);
}

export function optionalMoneyCents(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) : null;
}

export function invoiceFingerprint(invoice: ZohoInvoice): string {
  // Bind every field read from the invoice, including payment facts. These are
  // observations only; reconciliation never writes them back to either system.
  return quotePayloadHash(invoice);
}

export function orderReconciliationFingerprint(order: {
  current_status: string; price_quoted_cents: number; deposit_cents: number;
}): string {
  return quotePayloadHash({ stage: order.current_status, total: order.price_quoted_cents, deposit: order.deposit_cents });
}

export function invoiceReconciliationIssues(estimate: ZohoEstimate, invoice: ZohoInvoice, localInvoiceId: string | null): string[] {
  const issues: string[] = [];
  if (estimate.date && estimate.expiry_date && estimate.expiry_date < estimate.date) issues.push("The quotation expiry is before its issue date. Correct the dates in Zoho, then refresh.");
  const ids = estimate.invoice_ids ?? [];
  if (ids.length !== 1 || ids[0] !== invoice.invoice_id) issues.push("The quotation must link exactly one verified Zoho invoice. Review its invoice links in Zoho, then refresh.");
  if (localInvoiceId && localInvoiceId !== invoice.invoice_id) issues.push("CRM is linked to a different invoice. An admin must review the invoice links; they will not be replaced automatically.");
  if (invoice.customer_id !== estimate.customer_id || invoice.currency_code !== "SGD") issues.push("The invoice customer or currency does not match this quotation.");
  if (!invoice.status || !["draft", "sent", "overdue", "paid", "partially_paid"].includes(invoice.status)) issues.push("The existing invoice is void or unusable. Review it in Zoho, then refresh.");
  // Check invoice commercial data using the same exact representation checks as
  // the quotation. Invoice dates/terms are deliberately not quotation fields.
  const commercial: ZohoEstimate = { ...estimate, ...invoice, estimate_id: estimate.estimate_id, estimate_number: estimate.estimate_number, date: estimate.date, expiry_date: estimate.expiry_date, status: "draft", invoice_ids: [], total: invoice.total ?? NaN, line_items: invoice.line_items, discount: invoice.discount, discount_type: invoice.discount_type, is_inclusive_tax: invoice.is_inclusive_tax, tax_total: invoice.tax_total, taxes: invoice.taxes, adjustment: invoice.adjustment, shipping_charge: invoice.shipping_charge };
  const estimateCopy = { ...estimate, status: "draft", invoice_ids: [] };
  const estimateIssues = zohoAdoptionIssues(estimateCopy);
  const invoiceIssues = zohoAdoptionIssues(commercial);
  if (estimateIssues.length || invoiceIssues.length) issues.push(...estimateIssues, ...invoiceIssues.map((issue) => `Invoice: ${issue}`));
  if (!issues.length) {
    const quoteLines = zohoValidatedLines(estimateCopy);
    const invoiceLines = zohoValidatedLines(commercial);
    if (!quoteLines.length || !invoiceLines.length || !adoptedTotalMatches(quoteLines, estimateCopy) || !adoptedTotalMatches(invoiceLines, commercial)
      || optionalMoneyCents(invoice.total) !== optionalMoneyCents(estimate.total)
      || stableJson(quoteLines) !== stableJson(invoiceLines)) {
      issues.push("The quotation and invoice financial details differ. Review both documents in Zoho before importing; neither will be changed.");
    }
  }
  return [...new Set(issues)];
}
