import type { ZohoInvoice } from "@/lib/zoho/books";
import type { QuotationLineInput } from "@/lib/validation/quotation";
import { stableJson } from "./model";
import { quotePayloadHash } from "./hash";

export type CommercialLine = { itemId: string | null; name: string; description: string; quantity: string; rateCents: number; discountCents: number; discountInput: string; totalCents: number; taxId: string | null; taxPercent: string | null };
export type CommercialInvoice = { lines: CommercialLine[]; totalCents: number; taxCents: number; shippingCents: number; adjustmentCents: number; documentDiscountCents: number; taxes: Array<{ id: string | null; name: string; percent: string | null; amountCents: number }> };
// Parse decimal values without a floating tolerance or rounding sub-cent input.
function decimal(value: unknown): { numerator: bigint; scale: bigint; text: string } {
  if (typeof value !== "string" && typeof value !== "number") throw new Error("Missing numeric value");
  const text = String(value).trim();
  if (!/^\d+(?:\.\d{1,6})?$/.test(text)) throw new Error("Invalid decimal value");
  const [whole, fraction = ""] = text.split(".");
  const normalized = `${BigInt(whole)}${fraction.replace(/0+$/, "") ? `.${fraction.replace(/0+$/, "")}` : ""}`;
  return { numerator: BigInt(whole + fraction), scale: BigInt(10) ** BigInt(fraction.length), text: normalized };
}
export function exactCents(value: unknown): number {
  const parsed = decimal(value);
  if ((parsed.numerator * BigInt(100)) % parsed.scale) throw new Error("Money has fractions of a cent");
  const cents = Number(parsed.numerator * BigInt(100) / parsed.scale);
  if (!Number.isSafeInteger(cents) || cents > 100_000_000) throw new Error("Amount exceeds supported limit");
  return cents;
}
export function exactSignedCents(value: unknown): number {
  if (typeof value !== "string" && typeof value !== "number") throw new Error("Missing numeric value");
  const text = String(value).trim();
  return text.startsWith("-") ? -exactCents(text.slice(1)) : exactCents(text);
}
const rounded = (numerator: bigint, denominator: bigint): number => numerator < BigInt(0)
  ? -rounded(-numerator, denominator)
  : Number((numerator * BigInt(2) + denominator) / (denominator * BigInt(2)));
export function normalizeCommercialInvoice(invoice: ZohoInvoice): CommercialInvoice {
  if (!invoice.line_items?.length || invoice.line_items.length > 100) throw new Error("Invoice items are missing or exceed 100 lines");
  const taxCents = exactCents(invoice.tax_total ?? 0), shippingCents = exactCents(invoice.shipping_charge ?? 0), adjustmentCents = exactSignedCents(invoice.adjustment ?? 0);
  if (invoice.is_inclusive_tax) throw new Error("Inclusive-tax allocation cannot be verified exactly; review the tax-inclusive breakdown in Zoho.");
  const taxes = (invoice.taxes ?? []).map(tax => ({ id: tax.tax_id ?? null, name: tax.tax_name ?? "", percent: tax.tax_percentage == null ? null : decimal(tax.tax_percentage).text, amountCents: exactCents(tax.tax_amount) }));
  if (taxes.reduce((sum, tax) => sum + tax.amountCents, 0) !== taxCents) throw new Error("Invoice tax breakdown is missing or does not equal its tax total");
  const lines = invoice.line_items.map(line => {
    if (!line.name?.trim()) throw new Error("An invoice item name is missing");

    const quantity = decimal(line.quantity), rateCents = exactSignedCents(line.rate);
    if (quantity.numerator <= BigInt(0)) throw new Error("Item quantity must be positive");
    const gross = BigInt(rateCents) * quantity.numerator;
    const discountText = String(line.discount ?? 0);
    let discountCents: number;
    let totalCents: number;
    if (discountText.endsWith("%")) {
      const percent = decimal(discountText.slice(0, -1));
      if (percent.numerator > percent.scale * BigInt(100)) throw new Error("Invalid item discount");
      discountCents = rounded(gross * percent.numerator, quantity.scale * percent.scale * BigInt(100));
      totalCents = rounded(gross * (percent.scale * BigInt(100) - percent.numerator), quantity.scale * percent.scale * BigInt(100));
    } else {
      discountCents = exactCents(line.discount ?? 0);
      totalCents = rounded(gross, quantity.scale) - discountCents;
    }
    if ((rateCents >= 0 && totalCents < 0) || Math.abs(totalCents) > 100_000_000 || !Number.isSafeInteger(totalCents)) throw new Error("Invalid item total");
    if (line.discount_amount != null && exactSignedCents(line.discount_amount) !== discountCents) throw new Error("Item discount amount disagrees with its discount");
    if (line.item_total != null && exactSignedCents(line.item_total) !== totalCents) throw new Error("Item total disagrees with quantity, rate and discount");
    return { itemId: line.item_id || null, name: line.name.trim(), description: line.description ?? "", quantity: quantity.text, rateCents, discountCents, discountInput: discountText, totalCents, taxId: line.tax_id ?? null, taxPercent: decimal(line.tax_percentage ?? 0).text };
  });
  const totalCents = exactCents(invoice.total);
  const net = lines.reduce((sum, line) => sum + line.totalCents, 0);
  const documentDiscount = String(invoice.discount ?? 0);
  let documentDiscountCents: number;
  if (documentDiscount.endsWith("%")) {
    const pct = decimal(documentDiscount.slice(0, -1));
    if (pct.numerator > BigInt(100) * pct.scale) throw new Error("Invalid document discount");
    documentDiscountCents = rounded(BigInt(net) * pct.numerator, pct.scale * BigInt(100));
  } else documentDiscountCents = exactCents(documentDiscount);
  if (net - documentDiscountCents + taxCents + shippingCents + adjustmentCents !== totalCents) throw new Error("Invoice total does not equal items, discounts, taxes, shipping and adjustment");
  return { lines, totalCents, taxCents, shippingCents, adjustmentCents, documentDiscountCents, taxes };
}
export function commercialFromQuotation(lines: QuotationLineInput[], totalCents: number): CommercialInvoice {
  return normalizeCommercialInvoice({ invoice_id: "", total: totalCents / 100, line_items: lines.map(line => ({ item_id: line.zohoItemId ?? undefined, name: line.name, description: line.description, quantity: line.quantity, rate: line.rateCents / 100, discount: `${line.discountPercent}%` })) });
}
export function commercialFingerprint(document: CommercialInvoice): string {
  return quotePayloadHash({ ...document, lines: document.lines.map(({ discountInput: _discountInput, ...line }) => { void _discountInput; return stableJson({ ...line, description: line.description.trim().replace(/\s+/g, " ") }); }).sort(), taxes: document.taxes.map(tax => stableJson(tax)).sort() });
}
export function commercialEqual(a:CommercialInvoice,b:CommercialInvoice) {
  if(a.lines.length!==b.lines.length||commercialFingerprint({...a,lines:[]})!==commercialFingerprint({...b,lines:[]}))return false;
  const remaining=[...b.lines];
  for(const left of [...a.lines].sort((x,y)=>Number(Boolean(y.itemId))-Number(Boolean(x.itemId)))) {
    const key=commercialFingerprint({...a,lines:[{...left,itemId:null}]});
    const index=remaining.findIndex(right=>(!left.itemId||!right.itemId||left.itemId===right.itemId)&&commercialFingerprint({...a,lines:[{...right,itemId:null}]})===key);
    if(index<0)return false;remaining.splice(index,1);
  }
  return true;
}
export function invoiceUpdateIssues(invoice: ZohoInvoice): string[] {
  if (!["draft", "sent", "overdue"].includes(invoice.status ?? "")) return ["Only a verified unpaid draft, sent or overdue invoice can be updated."];
  try {
    if (exactCents(invoice.payment_made) !== 0 || exactCents(invoice.credits_applied) !== 0 || exactCents(invoice.balance) !== exactCents(invoice.total)) return ["The invoice has payment or credit activity. Use Zoho invoice details in CRM instead."];
    if (invoice.write_off_amount == null || exactCents(invoice.write_off_amount) !== 0 || exactCents(invoice.tax_amount_withheld ?? 0) !== 0 || invoice.ach_payment_initiated !== false) return ["Write-off, withholding or pending ACH activity is unknown or nonzero. Zoho updates are unavailable."];
  } catch { return ["Payment, credit or balance information is missing. Zoho updates are unavailable."]; }
  return [];
}

export function commercialWriteIssues(document: CommercialInvoice | null): string[] {
  if (!document) return ["Commercial invoice items cannot be verified."];
  return document.documentDiscountCents || document.taxCents || document.shippingCents || document.adjustmentCents || document.lines.some(line => line.taxId || Number(line.taxPercent ?? 0))
    ? ["Updating invoice tax, document discounts, shipping or adjustments from CRM is not supported. Use Zoho invoice details in CRM instead."] : [];
}

export function commercialUpdateLines(document: CommercialInvoice) {
  const lines = document.lines.map(line => ({ ...(line.itemId ? { item_id: line.itemId } : {}), name: line.name, description: line.description, quantity: Number(line.quantity), rate: line.rateCents / 100, discount: line.discountInput }));
  const roundTrip = normalizeCommercialInvoice({ invoice_id: "preview", total: document.totalCents / 100, line_items: lines });
  if (!commercialEqual(document, roundTrip)) throw new Error("The CRM invoice items cannot be serialized without changing their amounts");
  return lines;
}
