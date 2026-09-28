import type { QuotationLineInput } from "@/lib/validation/quotation";

export const DEFAULT_QUOTATION_TERMS = "Payment Terms: 50% deposit of total amount in quote to be paid on order confirmation, with the remaining 50% to be paid upon installation.\n\nInstallation date and time will be provided at a later date within 3-4 weeks from order confirmation.";

export function quotationDateOnly(value: Date | string): string;
export function quotationDateOnly(value: Date | string | null): string | null;
export function quotationDateOnly(value: Date | string | null): string | null {
  if (value === null) return null;
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

const RATE_DRAFT_PATTERN = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/;

export function parseRateDraftCents(text: string): number | null {
  const trimmed = text.trim();
  if (!RATE_DRAFT_PATTERN.test(trimmed)) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100) || 0;
}

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function defaultCustomerMessage(input: { customerName: string; displayId: string; totalCents: number; expiryDate: string | null }): string {
  const firstName = input.customerName.trim().split(/\s+/)[0] || "there";
  const amount = new Intl.NumberFormat("en-SG", { style: "currency", currency: "SGD" }).format(input.totalCents / 100);
  const validity = input.expiryDate ? ` and is valid until ${input.expiryDate}` : "";
  return `Hi ${firstName},\n\nYour Drapeworks quotation ${input.displayId} is ${amount}${validity}.\n\nPlease let me know if you have any questions or would like to proceed.`;
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

type ZohoEstimatePayloadInput = {
  contactId: string;
  referenceNumber: string;
  issueDate: string;
  expiryDate: string | null;
  lines: readonly QuotationLineInput[];
  notes: string;
  terms: string;
  salespersonName: string | null;
  templateId: string | null;
};

function buildZohoEstimatePayload(input: ZohoEstimatePayloadInput, discount: (percent: number) => number | string) {
  return {
    customer_id: input.contactId,
    reference_number: input.referenceNumber,
    date: input.issueDate,
    ...(input.expiryDate ? { expiry_date: input.expiryDate } : {}),
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
      discount: discount(line.discountPercent),
    })),
  };
}

// Zoho Books reads a bare numeric line discount as a flat amount — 15 meant
// SGD 15.00 off, not 15%. A percentage discount must carry the "%" sign, so
// every outbound payload serializes the stored percent verbatim ("15%").
export function toZohoEstimatePayload(input: ZohoEstimatePayloadInput) {
  return buildZohoEstimatePayload(input, (percent) => `${percent}%`);
}

// Quotations synced before the percentage fix stored hash(full payload) with
// the discount as a bare number. Invoice-time verification rebuilds exactly
// those bytes, so this variant preserves the historical serialization and is
// never used for a live request.
export function toLegacyZohoEstimatePayload(input: ZohoEstimatePayloadInput) {
  return buildZohoEstimatePayload(input, (percent) => percent);
}
