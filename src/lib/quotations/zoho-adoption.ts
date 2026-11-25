import type { ZohoEstimate } from "@/lib/zoho/books";
import { quotationLineSchema, type QuotationLineInput } from "@/lib/validation/quotation";
import { quotationTotalCents } from "./model";

// A Zoho line discount is unambiguous only when it carries the "%" sign (the
// sync direction writes "15%"). A bare nonzero number on a response is a flat
// amount per the Zoho Estimate schema, and the CRM cannot model amount
// discounts — returning null makes the caller reject instead of silently
// reinterpreting it as a percentage.
export function zohoLineDiscountPercent(discount: unknown): number | null {
  if (discount === null || discount === undefined || discount === "") return 0;
  const text = String(discount).trim();
  if (text.endsWith("%")) {
    const value = Number(text.slice(0, -1));
    return Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
  }
  const value = Number(text);
  return Number.isFinite(value) && value === 0 ? 0 : null;
}

// A Zoho "YYYY-MM-DD" that is also a real calendar date — "2026-02-30" must
// never reach the database or storage key and surface as an opaque error.
export function isValidZohoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

// The CRM models per-line percentage discounts only. Anything else on a Zoho
// estimate (document-level discount, taxes, adjustment, shipping, or a
// fixed-amount/ambiguous line discount) is reported as a readable issue so
// adoption can refuse rather than misquote the customer. A line whose
// discount is an explicit percentage may still carry discount_amount and
// item_total — those are Zoho's computed echoes and are accepted only when
// they agree with the percentage to the exact cent.
export function zohoAdoptionIssues(remote: ZohoEstimate): string[] {
  const issues: string[] = [];
  if (remote.status === "invoiced" || (remote.invoice_ids?.length ?? 0) > 0) {
    issues.push("it has already been invoiced in Zoho");
  }
  if (!isValidZohoDate(remote.date) || (remote.expiry_date && !isValidZohoDate(remote.expiry_date))) {
    issues.push("its dates are missing or are not valid calendar dates");
  }
  // Same explicit-percentage rule as line discounts: "0%"/"0.00%"/0 are
  // representable; anything else (incl. NaN) is not.
  if (zohoLineDiscountPercent(remote.discount) !== 0) {
    issues.push("it has a document-level discount the CRM cannot represent");
  }
  const taxTotal = Number(remote.tax_total ?? 0);
  const taxedEntities = (remote.taxes ?? []).some((tax) => Number(tax.tax_amount ?? 0) !== 0)
    || (remote.taxes ?? []).some((tax) => Number(tax.tax_percentage ?? 0) !== 0);
  if (taxTotal !== 0 || taxedEntities) {
    issues.push("it has taxes the CRM cannot represent");
  }
  if (Number(remote.adjustment ?? 0) !== 0) {
    issues.push("it has an adjustment the CRM cannot represent");
  }
  if (Number(remote.shipping_charge ?? 0) !== 0) {
    issues.push("it has a shipping charge the CRM cannot represent");
  }
  if (String(remote.notes ?? "").length > 5000 || String(remote.terms ?? "").length > 5000) {
    issues.push("its notes or terms exceed the CRM's 5000-character limit");
  }
  const lines = remote.line_items ?? [];
  if (lines.length === 0) {
    issues.push("it has no line items");
  }
  if (lines.length > 100) {
    issues.push("it has more than 100 line items, the most the CRM can store");
  }
  for (const line of lines) {
    const name = line.name || "a line item";
    const quantity = Number(line.quantity);
    const rate = Number(line.rate);
    if (!Number.isFinite(quantity)) {
      issues.push(`"${name}" has a quantity the CRM cannot represent`);
    }
    // Rates are stored as integer cents; a sub-cent rate would be silently
    // rounded, so it is rejected instead (ordinary float error is tolerated).
    if (!Number.isFinite(rate) || Math.abs(rate * 100 - Math.round(rate * 100)) > 1e-6) {
      issues.push(`"${name}" has a rate the CRM cannot store exactly in cents`);
    }
    const percent = zohoLineDiscountPercent(line.discount);
    if (percent === null) {
      issues.push(`"${name}" has a discount that is not an explicit percentage the CRM can represent`);
    } else {
      const gross = quantity * rate;
      const expectedAmount = (gross * percent) / 100;
      // Echoes are compared in integer cents: a whole-cent disagreement is a
      // mismatch, and a non-finite echo is a mismatch too (NaN never compares).
      if (line.discount_amount !== undefined && line.discount_amount !== null
        && (!Number.isFinite(Number(line.discount_amount)) || Math.round(Number(line.discount_amount) * 100) !== Math.round(expectedAmount * 100))) {
        issues.push(`"${name}" has a discount amount that does not match its percentage`);
      }
      if (line.item_total !== undefined && line.item_total !== null
        && (!Number.isFinite(Number(line.item_total)) || Math.round(Number(line.item_total) * 100) !== Math.round((gross - expectedAmount) * 100))) {
        issues.push(`"${name}" total does not match its quantity, rate and discount`);
      }
    }
    if (line.tax_id || Number(line.tax_percentage ?? 0) !== 0) {
      issues.push(`"${name}" has a tax the CRM cannot represent`);
    }
  }
  return issues;
}

// Converts the remote estimate into CRM quotation lines. Callers must run
// zohoAdoptionIssues first: this throws on any discount it cannot read as an
// explicit percentage rather than guessing. The result is always re-validated
// against quotationLineSchema by zohoValidatedLines before it is stored.
export function zohoLinesFromEstimate(remote: ZohoEstimate): QuotationLineInput[] {
  return (remote.line_items ?? []).map((line, index) => {
    const discountPercent = zohoLineDiscountPercent(line.discount);
    if (discountPercent === null) {
      throw new Error(`Zoho line ${index + 1} discount is not an explicit percentage`);
    }
    return {
      zohoItemId: line.item_id || null,
      name: line.name || "Zoho item",
      description: line.description ?? "",
      quantity: Number(line.quantity),
      rateCents: Math.round(Number(line.rate) * 100),
      discountPercent,
    };
  });
}

// Schema-validated adoption lines: refuses NaN, out-of-range, negative or
// otherwise unrepresentable values instead of persisting them.
export function zohoValidatedLines(remote: ZohoEstimate): QuotationLineInput[] {
  const parsed = quotationLineSchema.array().min(1).max(100).safeParse(zohoLinesFromEstimate(remote));
  if (!parsed.success) return [];
  return parsed.data;
}

// Display shape for the comparison dialog. The discount is shown as the
// percentage when it is one; a verbatim amount label when Zoho reports a
// fixed amount; the raw value only for genuinely ambiguous input.
export function zohoLineForDisplay(line: NonNullable<ZohoEstimate["line_items"]>[number]) {
  const percent = zohoLineDiscountPercent(line.discount);
  const amount = Number(line.discount_amount ?? 0);
  return {
    name: line.name || "Zoho item",
    description: line.description ?? "",
    quantity: Number(line.quantity),
    rateCents: Math.round(Number(line.rate) * 100),
    discountText: percent !== null && (percent > 0 || amount === 0)
      ? `${percent}%`
      : amount !== 0
        ? `S$${amount.toFixed(2)}`
        : line.discount ? String(line.discount) : "0%",
  };
}

export function zohoRemoteTotalCents(remote: ZohoEstimate): number {
  return Math.round(Number(remote.total) * 100);
}

export function adoptedTotalMatches(lines: QuotationLineInput[], remote: ZohoEstimate): boolean {
  const remoteCents = zohoRemoteTotalCents(remote);
  return Number.isFinite(remoteCents) && remoteCents >= 0 && quotationTotalCents(lines) === remoteCents;
}
