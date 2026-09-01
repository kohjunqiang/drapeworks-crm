const CATEGORY_LABEL = {
  day: "Day",
  night: "Night",
  blind: "Blinds",
} as const;

/**
 * The customer reference is document content. The customer name in this
 * filename comes from the order's customer record and is deliberately kept
 * separate from CUST REF.
 */
export function poFileName(
  poNumber: string,
  customerName: string | null,
  category: string | null,
  vendorName: string | null,
): string {
  const slug = (value: string) =>
    value.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const parts = [
    "PO",
    slug(poNumber),
    customerName ? slug(customerName) : "",
    category && category in CATEGORY_LABEL
      ? CATEGORY_LABEL[category as keyof typeof CATEGORY_LABEL]
      : category
        ? slug(category)
        : "",
    vendorName ? slug(vendorName) : "",
  ].filter(Boolean);

  return `${parts.join("-") || "PO"}.pdf`;
}
