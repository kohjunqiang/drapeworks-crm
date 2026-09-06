import { z } from "zod";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date");

export const quotationLineSchema = z.object({
  zohoItemId: z.string().trim().min(1).max(64).nullable(),
  name: z.string().trim().min(1, "Every line needs a name").max(200),
  description: z.string().trim().max(2000),
  quantity: z.coerce.number().positive().max(9999),
  rateCents: z.coerce.number().int().min(0).max(100_000_000),
  discountPercent: z.coerce.number().min(0).max(100),
});

export const saveQuotationSchema = z.object({
  orderId: z.string().uuid(),
  quotationId: z.string().uuid().nullable(),
  expectedUpdatedAt: z.string().datetime().nullable(),
  issueDate: date,
  expiryDate: date,
  lines: z.array(quotationLineSchema).min(1, "Add at least one quotation line").max(100),
  customerMessage: z.string().max(5000),
  notes: z.string().max(5000),
  terms: z.string().max(5000),
}).superRefine((value, ctx) => {
  if (value.quotationId && !value.expectedUpdatedAt) ctx.addIssue({ code: "custom", path: ["expectedUpdatedAt"], message: "Refresh this quotation before saving" });
  if (value.expiryDate < value.issueDate) ctx.addIssue({ code: "custom", path: ["expiryDate"], message: "Expiry date cannot be before the issue date" });
});

export const quotationIdSchema = z.string().uuid("That quotation is not valid");

export const confirmZohoCustomerSchema = z.object({
  orderId: z.string().uuid(),
  zohoContactId: z.string().trim().min(1).max(64),
});

export const sendQuotationSchema = z.object({
  quotationId: quotationIdSchema,
  channel: z.enum(["WhatsApp", "Email", "In person", "Other"]),
  note: z.string().trim().max(2000),
});

export type QuotationLineInput = z.infer<typeof quotationLineSchema>;
export type SaveQuotationInput = z.infer<typeof saveQuotationSchema>;
