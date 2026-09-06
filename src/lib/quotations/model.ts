import type { QuotationLineInput } from "@/lib/validation/quotation";

export const DEFAULT_QUOTATION_TERMS = "Payment Terms: 50% deposit of total amount in quote to be paid on order confirmation, with the remaining 50% to be paid upon installation.\n\nInstallation date and time will be provided at a later date within 3-4 weeks from order confirmation.";

export function quotationDateOnly(value: Date | string): string {
  return value instanceof Date
    ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Singapore", year: "numeric", month: "2-digit", day: "2-digit" }).format(value)
    : value.slice(0, 10);
}

export function quotationTotalCents(lines: readonly QuotationLineInput[]): number {
  return lines.reduce((sum, line) => {
    const gross = line.rateCents * line.quantity;
    return sum + Math.round(gross * (1 - line.discountPercent / 100));
  }, 0);
}

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function defaultCustomerMessage(input: { customerName: string; displayId: string; totalCents: number; expiryDate: string }): string {
  const firstName = input.customerName.trim().split(/\s+/)[0] || "there";
  const amount = new Intl.NumberFormat("en-SG", { style: "currency", currency: "SGD" }).format(input.totalCents / 100);
  return `Hi ${firstName},\n\nYour Drapeworks quotation ${input.displayId} is ${amount} and is valid until ${input.expiryDate}.\n\nPlease let me know if you have any questions or would like to proceed.`;
}

export function isGeneratedCustomerMessage(
  message: string,
  input: Omit<Parameters<typeof defaultCustomerMessage>[0], "displayId">,
  displayIds: readonly string[],
): boolean {
  return displayIds.some((displayId) =>
    message === defaultCustomerMessage({ ...input, displayId })
  );
}

export function toZohoEstimatePayload(input: {
  contactId: string;
  referenceNumber: string;
  issueDate: string;
  expiryDate: string;
  lines: readonly QuotationLineInput[];
  notes: string;
  terms: string;
  salespersonName: string | null;
  templateId: string | null;
}) {
  return {
    customer_id: input.contactId,
    reference_number: input.referenceNumber,
    date: input.issueDate,
    expiry_date: input.expiryDate,
    discount_type: "item_level",
    is_inclusive_tax: false,
    ...(input.templateId ? { template_id: input.templateId } : {}),
    ...(input.salespersonName ? { salesperson_name: input.salespersonName } : {}),
    notes: input.notes,
    terms: input.terms,
    line_items: input.lines.map((line) => ({
      ...(line.zohoItemId ? { item_id: line.zohoItemId } : { name: line.name }),
      description: line.description,
      quantity: line.quantity,
      rate: line.rateCents / 100,
      discount: line.discountPercent,
    })),
  };
}
