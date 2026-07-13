import { z } from "zod";

export const CURTAIN_CATEGORIES = ["Day", "Night"] as const;
export type CurtainCategory = (typeof CURTAIN_CATEGORIES)[number];

// Shared client + server. The photo is uploaded via a
// separate action (request-signed-URL → PUT → confirm); the form submits an
// already-uploaded path (or none, since a type can be saved before its photo).
// Sample-book page reference — always starts with "P" (e.g. P12, P12a). An
// empty field means "no page yet" rather than a validation error. Uses a
// union (not preprocess) so the RHF resolver input type stays a plain string.
const pageField = z
  .union([
    z.literal(""),
    z.string().max(20).regex(/^P/i, "Page must start with P (e.g. P12)"),
  ])
  .optional()
  .transform((v) => (v ? v : undefined));

// NOTE: pricing (vendor + cost + sale) lives on the SERIES, not the curtain
// type — see curtain-series.ts. Every type inherits its series' price.
export const curtainTypeSchema = z.object({
  isNew: z.boolean(),
  id: z.string().uuid().optional(), // present on edit
  label: z.string().min(1, "Required").max(120),
  category: z.enum(CURTAIN_CATEGORIES),
  // The physical category this curtain type belongs to (required).
  series_id: z.string().uuid("Select a series"),
  page: pageField,
  photo_path: z.string().optional(),
  photo_mime: z.string().optional(),
});

export type CurtainTypeInput = z.infer<typeof curtainTypeSchema>;
