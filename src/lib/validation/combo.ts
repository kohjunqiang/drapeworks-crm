import { z } from "zod";

// Shared client + server. A combo is an admin-managed fixed bundle price
// (e.g. "Signature Set = Day Sheer + Night Signature → $450/window"). The
// optional day/night series are advisory (what the bundle nominally pairs);
// the price is what actually overrides a picked window's sale. Entered as a
// decimal SGD string; the action converts to integer cents.
const optionalSeriesId = z.preprocess(
  (v) => (v === "" || v === null ? undefined : v),
  z.string().uuid().optional(),
);

export const comboSchema = z.object({
  isNew: z.boolean(),
  id: z.string().uuid().optional(), // present on edit
  name: z.string().trim().min(1, "Required").max(120),
  day_series_id: optionalSeriesId,
  night_series_id: optionalSeriesId,
  price_sgd: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, "Enter a valid amount (e.g. 450 or 450.00)"),
  is_active: z.boolean().optional(),
});

export type ComboInput = z.infer<typeof comboSchema>;
