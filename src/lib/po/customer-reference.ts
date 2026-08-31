/** A saved reference overrides the historic customer/development default. */
export function customerReference(order: {
  po_customer_reference?: string | null;
  customer_name: string;
  development: string | null;
  unit_type: string | null;
}): string | null {
  const saved = order.po_customer_reference?.trim();
  if (saved) return saved;
  const parts = [order.customer_name, order.development, order.unit_type]
    .map((part) => part?.trim())
    .filter(Boolean);
  return parts.length ? parts.join(" ") : null;
}
