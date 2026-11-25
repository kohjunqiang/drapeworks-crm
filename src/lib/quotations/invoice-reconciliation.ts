import type { ZohoEstimate, ZohoInvoice } from "@/lib/zoho/books";
import { quotePayloadHash } from "./hash";
import { stableJson } from "./model";
import { adoptedTotalMatches, zohoAdoptionIssues, zohoLineDiscountPercent, zohoValidatedLines } from "./zoho-adoption";

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

function sgd(cents: number): string {
  return `S$${(cents / 100).toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// What an already-invoiced import must prove before it may apply: the linked
// invoice is the single document the quotation points at, for the same
// customer in SGD, in a usable state, with a verifiable non-negative total —
// and the quotation itself is a clean CRM-representable snapshot. Financial
// differences between the documents are NOT identity errors; they are
// reported by invoiceFinancialDifferences for explicit acknowledgement.
export function invoiceReconciliationIssues(estimate: ZohoEstimate, invoice: ZohoInvoice, localInvoiceId: string | null): string[] {
  const issues: string[] = [];
  if (estimate.date && estimate.expiry_date && estimate.expiry_date < estimate.date) issues.push("The quotation expiry is before its issue date. Correct the dates in Zoho, then refresh.");
  const ids = estimate.invoice_ids ?? [];
  if (ids.length !== 1 || ids[0] !== invoice.invoice_id) issues.push("The quotation must link exactly one verified Zoho invoice. Review its invoice links in Zoho, then refresh.");
  if (localInvoiceId && localInvoiceId !== invoice.invoice_id) issues.push("CRM is linked to a different invoice. An admin must review the invoice links; they will not be replaced automatically.");
  if (invoice.customer_id !== estimate.customer_id || invoice.currency_code !== "SGD") issues.push("The invoice customer or currency does not match this quotation.");
  if (!invoice.status || !["draft", "sent", "overdue", "paid", "partially_paid"].includes(invoice.status)) issues.push("The existing invoice is void or unusable. Review it in Zoho, then refresh.");
  // The invoice is never imported, so its lines do not need to be
  // CRM-representable — but its total must be a verifiable amount before the
  // CRM may link it.
  if (optionalMoneyCents(invoice.total) === null) issues.push("The invoice total could not be verified. Check the invoice in Zoho, then refresh.");
  const estimateCopy = { ...estimate, status: "draft", invoice_ids: [] };
  const estimateIssues = zohoAdoptionIssues(estimateCopy);
  if (estimateIssues.length) issues.push(...estimateIssues);
  else {
    const quoteLines = zohoValidatedLines(estimateCopy);
    if (!quoteLines.length || !adoptedTotalMatches(quoteLines, estimateCopy)) {
      issues.push("The quotation line items do not add up to the Zoho quotation total; reconcile it in Zoho Books first.");
    }
  }
  return [...new Set(issues)];
}

// Both documents' raw lines normalized to what a quotation and an invoice can
// honestly be compared on: name, quantity, rate and net line amount. Returns
// null when any line cannot be read — the caller reports that as unverifiable
// instead of treating the two sides as matching.
function comparableZohoLines(lines: ZohoEstimate["line_items"]): Array<{ name: string; quantity: number; rateCents: number; totalCents: number }> | null {
  if (!lines?.length) return null;
  const comparable = [];
  for (const line of lines) {
    const quantity = Number(line.quantity);
    const rate = Number(line.rate);
    if (!Number.isFinite(quantity) || !Number.isFinite(rate)) return null;
    const gross = quantity * rate;
    let net: number;
    const echo = Number(line.item_total);
    if (line.item_total !== undefined && line.item_total !== null && Number.isFinite(echo)) {
      net = echo;
    } else {
      const percent = zohoLineDiscountPercent(line.discount);
      const flat = Number(line.discount_amount);
      if (percent !== null) net = gross - (gross * percent) / 100;
      else if (Number.isFinite(flat)) net = gross - flat;
      else return null;
    }
    comparable.push({ name: String(line.name ?? ""), quantity, rateCents: Math.round(rate * 100), totalCents: Math.round(net * 100) });
  }
  return comparable;
}

// A document-level money component that is legitimately absent: missing and
// explicit zero both normalize to zero cents, while a present-but-unreadable
// value is null — unverifiable, never silently matching. Unlike
// optionalMoneyCents, negatives are real values here (a negative adjustment).
function componentMoneyCents(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return 0;
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) : null;
}

// The header tax figure. When tax_total is absent the itemized taxes are the
// only source, so they are summed; a present tax_total stays authoritative.
function documentTaxCents(document: { tax_total?: unknown; taxes?: ZohoEstimate["taxes"] }): number | null {
  if (document.tax_total !== undefined && document.tax_total !== null && document.tax_total !== "") {
    return componentMoneyCents(document.tax_total);
  }
  let sum = 0;
  for (const tax of document.taxes ?? []) {
    const amount = Number(tax.tax_amount);
    if (!Number.isFinite(amount)) return null;
    sum += amount;
  }
  return Math.round(sum * 100);
}

// Document-level discount as a readable descriptor: zero in any spelling is
// "none", an explicit percentage stays a percentage and a flat amount is its
// S$ figure, so differing representations never look equal. Unreadable → null.
function documentDiscountDescriptor(discount: unknown): string | null {
  if (discount === undefined || discount === null || discount === "") return "none";
  const percent = zohoLineDiscountPercent(discount);
  if (percent !== null) return percent === 0 ? "none" : `${percent}%`;
  const amount = Number(String(discount).trim());
  if (!Number.isFinite(amount)) return null;
  return amount === 0 ? "none" : sgd(Math.round(amount * 100));
}

// Differences between the three amounts an invoiced import touches — the Zoho
// quotation, the Zoho invoice it links, and the preserved CRM order total.
// None of them block the import: the invoice and every payment figure stay
// exactly as they are, so each difference is a warning the reviewer must
// explicitly acknowledge instead of a silent fix.
export function invoiceFinancialDifferences(estimate: ZohoEstimate, invoice: ZohoInvoice, orderTotalCents: number | null): string[] {
  const differences: string[] = [];
  const quoteCents = optionalMoneyCents(estimate.total);
  const invoiceCents = optionalMoneyCents(invoice.total);
  if (quoteCents === null || invoiceCents === null) {
    differences.push("The quotation or invoice total could not be read, so the two documents could not be compared.");
  } else if (invoiceCents !== quoteCents) {
    differences.push(`The Zoho invoice total ${sgd(invoiceCents)} differs from the quotation total ${sgd(quoteCents)}.`);
  } else {
    const quoteLines = comparableZohoLines(estimate.line_items);
    const invoiceLines = comparableZohoLines(invoice.line_items);
    if (!quoteLines || !invoiceLines) {
      differences.push("The invoice line items could not be verified against the quotation lines; only the totals were compared.");
    } else if (stableJson(quoteLines) !== stableJson(invoiceLines)) {
      const detail: string[] = [];
      const count = Math.max(quoteLines.length, invoiceLines.length);
      for (let index = 0; index < count && detail.length < 5; index += 1) {
        const quote = quoteLines[index];
        const invoiced = invoiceLines[index];
        if (!quote || !invoiced) detail.push(`line ${index + 1} exists only on the ${quote ? "quotation" : "invoice"}`);
        else if (stableJson(quote) !== stableJson(invoiced)) {
          detail.push(`line ${index + 1}: quotation "${quote.name}" ${quote.quantity} × ${sgd(quote.rateCents)} (net ${sgd(quote.totalCents)}) vs invoice "${invoiced.name}" ${invoiced.quantity} × ${sgd(invoiced.rateCents)} (net ${sgd(invoiced.totalCents)})`);
        }
      }
      const extra = count > detail.length && detail.length === 5 ? `; and ${count - 5} more` : "";
      differences.push(`The invoice lines differ from the quotation lines although the totals match: ${detail.join("; ")}${extra}.`);
    }
  }
  // Header components are compared even when they offset inside an unchanged
  // total: a tax that exactly cancels an adjustment is still a difference the
  // reviewer must see. Missing/zero stays missing/zero; unreadable is
  // reported, not treated as matching.
  const components: Array<{ label: string; quote: number | string | null; invoice: number | string | null }> = [
    { label: "tax total", quote: documentTaxCents(estimate), invoice: documentTaxCents(invoice) },
    { label: "adjustment", quote: componentMoneyCents(estimate.adjustment), invoice: componentMoneyCents(invoice.adjustment) },
    { label: "shipping charge", quote: componentMoneyCents(estimate.shipping_charge), invoice: componentMoneyCents(invoice.shipping_charge) },
    { label: "document-level discount", quote: documentDiscountDescriptor(estimate.discount), invoice: documentDiscountDescriptor(invoice.discount) },
  ];
  for (const component of components) {
    if (component.quote === null || component.invoice === null) {
      differences.push(`The ${component.label} could not be verified on both documents.`);
    } else if (component.quote !== component.invoice) {
      const text = (value: number | string) => typeof value === "number" ? sgd(value) : value;
      differences.push(`The ${component.label} differs: quotation ${text(component.quote)} vs invoice ${text(component.invoice)}.`);
    }
  }
  if (orderTotalCents !== null && quoteCents !== null && quoteCents !== orderTotalCents) {
    differences.push(`The CRM order total ${sgd(orderTotalCents)} differs from the imported quotation total ${sgd(quoteCents)}; the order total, deposit and payment records stay unchanged.`);
  }
  return differences;
}
