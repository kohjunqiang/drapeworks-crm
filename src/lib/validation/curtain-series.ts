import { z } from "zod";

export const CURTAIN_CALC_METHODS = ["by_width", "by_sqm"] as const;
export type CurtainCalcMethod = (typeof CURTAIN_CALC_METHODS)[number];

// Which product line a series sells. Set from the catalogue tab the series is
// created on and NOT editable afterwards: moving a series between lines would
// silently change how every window referencing it is priced and installed.
export const CURTAIN_PRODUCT_LINES = ["curtain", "blind"] as const;
export type CurtainProductLineInput = (typeof CURTAIN_PRODUCT_LINES)[number];

// A price entered as a decimal amount (RMB or SGD), e.g. "51" or "90.50". Empty
// means "not set yet". The server action converts it to integer cents.
const priceField = z
  .union([
    z.literal(""),
    z
      .string()
      .regex(/^\d+(\.\d{1,2})?$/, "Enter a valid amount (e.g. 51 or 90.50)"),
  ])
  .optional();

// Chosen vendor — optional (a series can exist before it is priced).
const vendorField = z.union([z.literal(""), z.string().uuid()]).optional();

// Shared client + server. A curtain series is the "physical category" a curtain
// type belongs to; the running per-series index keys off its id. Pricing
// (Phase 9) lives here — every curtain type in the series inherits it.
export const curtainSeriesSchema = z.object({
  isNew: z.boolean(),
  id: z.string().uuid().optional(), // present on edit
  name: z.string().min(1, "Required").max(120),
  is_active: z.boolean().optional(),
  // Pricing — all optional.
  vendor_id: vendorField,
  cost_rmb: priceField, // vendor cost per metre (RMB)
  sale_sgd: priceField, // curated sale price per metre (SGD)
  calc_method: z.enum(CURTAIN_CALC_METHODS).default("by_width"),
  product_line: z.enum(CURTAIN_PRODUCT_LINES).default("curtain"),
});

export type CurtainSeriesInput = z.infer<typeof curtainSeriesSchema>;
