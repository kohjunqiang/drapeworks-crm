import { z } from "zod";

// Admin-managed mesh catalogue: categories (which carry the per-ft² rates) and
// colours. Everything here is created through /admin/product/mesh — there is
// deliberately no seed script, so the app has exactly one answer to "where do
// mesh categories come from".

// Money as typed on the form: blank, or a decimal with up to 2 places. Blank
// means "not configured", which is a real state — a category can exist before
// anyone prices it. Mirrors the add-on price field on pricing settings.
const priceField = z
  .union([
    z.literal(""),
    z
      .string()
      .regex(/^\d+(\.\d{1,2})?$/, "Enter a valid amount (e.g. 27 or 50.00)"),
  ])
  .optional();

export const meshCategorySchema = z.object({
  isNew: z.boolean(),
  id: z.string().uuid().optional(),
  // Stored verbatim as typed — no prefix stripping, no typo correction.
  name: z.string().trim().min(1, "Required").max(120),
  description: z.string().trim().max(500).optional(),
  // No .transform() here: a transform makes the schema's input and output
  // types differ, which React Hook Form's zodResolver can't reconcile. The
  // action normalises "" to null instead.
  vendor_id: z.string().uuid().or(z.literal("")).optional(),
  // Per-square-foot rates. A panel's price is its area in ft² × these, so the
  // category is where mesh pricing lives — there is no separate price grid.
  // Blank sale = not yet priced; blank cost = margin unreliable.
  cost_rmb_per_sqft: priceField,
  sale_sgd_per_sqft: priceField,
});

export const meshColourSchema = z.object({
  isNew: z.boolean(),
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, "Required").max(120),
  // Flat per-panel surcharge, not scaled by area. Blank = no surcharge.
  surcharge_rmb: priceField,
  surcharge_sgd: priceField,
});

// One row of the track-system matrix: a width band and the system each draw
// type needs at that width. A blank system means "not possible" — a real
// answer, not a missing one, which is why it is allowed through.
export const meshSystemBandSchema = z.object({
  isNew: z.boolean(),
  id: z.string().uuid().optional(),
  max_width_cm: z
    .string()
    .regex(/^\d+$/, "Enter a whole number of centimetres")
    .refine((v) => Number(v) > 0, "Must be greater than 0"),
  single_system: z.string().trim().max(120).optional(),
  double_system: z.string().trim().max(120).optional(),
});

// Physical dimensions of a track system, typed in cm with one decimal place
// and stored as integer millimetres — the supplier quotes 6.5, 4.3, 1.5.
const mmField = z
  .string()
  .regex(/^\d+(\.\d)?$/, "Enter a length in cm (e.g. 6.5)")
  .refine((v) => Number(v) > 0, "Must be greater than 0");

export const meshSystemSchema = z.object({
  isNew: z.boolean(),
  id: z.string().uuid().optional(),
  // Matched to the matrix by name, so it is stored verbatim as typed.
  name: z.string().trim().min(1, "Required").max(120),
  roller_cm: mmField,
  handle_cm: mmField,
  side_track_cm: mmField,
  track_height_cm: mmField,
  track_depth_cm: mmField,
  // Flat per-panel surcharge for a double draw — one extra roller-and-handle
  // set, not scaled by area. Blank = no surcharge.
  double_cost_rmb: priceField,
  double_sale_sgd: priceField,
});

/** cm as typed → integer mm. "6.5" → 65. */
export function cmToMm(v: string): number {
  return Math.round(Number(v) * 10);
}

/** Integer mm → cm for display. 65 → "6.5". */
export function mmToCm(v: number): string {
  return String(v / 10);
}

export type MeshCategoryInput = z.infer<typeof meshCategorySchema>;
export type MeshSystemInput = z.infer<typeof meshSystemSchema>;
export type MeshColourInput = z.infer<typeof meshColourSchema>;
export type MeshSystemBandInput = z.infer<typeof meshSystemBandSchema>;
