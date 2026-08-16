import { z } from "zod";

// Admin-managed mesh catalogue: categories (which carry the per-ft² rates) and
// colours. Everything here is created through /admin/mesh — there is
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

export type MeshCategoryInput = z.infer<typeof meshCategorySchema>;
export type MeshColourInput = z.infer<typeof meshColourSchema>;
