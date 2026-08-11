import { z } from "zod";

// Admin-managed mesh catalogue: categories, colours, size bands and the
// category × band price grid. Everything here is created through /admin/mesh —
// there is deliberately no seed script, so the app has exactly one answer to
// "where do mesh categories come from".

// Money as typed on the form: blank, or a decimal with up to 2 places. Blank
// means "not configured", which is a real state — a grid cell can exist before
// anyone fills it in. Mirrors the add-on price field on pricing settings.
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
});

export const meshColourSchema = z.object({
  isNew: z.boolean(),
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, "Required").max(120),
  // Flat per-panel surcharge, not scaled by area. Blank = no surcharge.
  surcharge_rmb: priceField,
  surcharge_sgd: priceField,
});

// Area threshold in m² as typed (e.g. "2" or "2.5"), converted to integer cm²
// for storage so band matching never touches a float. Blank = the open-ended
// top band, of which at most one may be active (enforced by a partial unique
// index, not just by this schema).
const areaField = z
  .union([
    z.literal(""),
    z
      .string()
      .regex(/^\d+(\.\d{1,3})?$/, "Enter an area in m² (e.g. 2 or 2.5)"),
  ])
  .optional();

export const meshSizeBandSchema = z.object({
  isNew: z.boolean(),
  id: z.string().uuid().optional(),
  label: z.string().trim().min(1, "Required").max(120),
  max_area_sqm: areaField,
});

export const meshPriceCellSchema = z.object({
  category_id: z.string().uuid(),
  band_id: z.string().uuid(),
  cost_rmb: priceField,
  sale_sgd: priceField,
});

export type MeshCategoryInput = z.infer<typeof meshCategorySchema>;
export type MeshColourInput = z.infer<typeof meshColourSchema>;
export type MeshSizeBandInput = z.infer<typeof meshSizeBandSchema>;
export type MeshPriceCellInput = z.infer<typeof meshPriceCellSchema>;

/** m² as typed → integer cm². "2" → 20000. Blank → null (open-ended band). */
export function sqmToCm2(v: string | undefined): number | null {
  if (v === undefined || v === "") return null;
  return Math.round(Number(v) * 10000);
}

/** Integer cm² → m² for display. 20000 → "2". Null → "". */
export function cm2ToSqm(v: number | null): string {
  if (v == null) return "";
  return String(v / 10000);
}
