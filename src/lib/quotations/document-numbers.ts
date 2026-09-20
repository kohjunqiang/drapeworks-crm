// Document numbers derived from the Zoho quotation number.
//
// Zoho owns the estimate number (QT-677816) and auto-numbers converted invoices
// on its own sequence. The CRM renumbers the invoice on the quotation's suffix
// so the two documents tally: QT-677816 → INV-677816.

/**
 * The numeric tail of a Zoho document number: strips ONE leading alphabetic
 * prefix plus its hyphen ("QT-677816" → "677816"). A number without such a
 * prefix is used whole. Null when the estimate number is empty or absent.
 */
export function documentNumberSuffix(estimateNumber: string | null | undefined): string | null {
  const trimmed = estimateNumber?.trim() ?? "";
  if (!trimmed) return null;
  return trimmed.replace(/^[A-Za-z]+-/, "") || null;
}

export function invoiceNumberFor(estimateNumber: string | null | undefined): string | null {
  const suffix = documentNumberSuffix(estimateNumber);
  return suffix ? `INV-${suffix}` : null;
}
