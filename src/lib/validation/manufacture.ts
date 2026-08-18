import { z } from "zod";

export const ALLOWANCE_LINES = ["curtain", "blind", "mesh"] as const;

// Bounded at ±100cm. A metre of allowance is not a plausible hem or clearance;
// anything larger is a typo, and catching it here is cheaper than catching it
// on a vendor's cutting table.
const deltaCm = z
  .number()
  .int("Allowance must be a whole number of centimetres")
  .min(-100, "Allowance must be between -100 and 100 cm")
  .max(100, "Allowance must be between -100 and 100 cm");

export const allowanceSchema = z.object({
  productLine: z.enum(ALLOWANCE_LINES),
  widthDeltaCm: deltaCm,
  heightDeltaCm: deltaCm,
});

// The confirm payload.
//
// Deltas and computed manufacturing dimensions are DELIBERATELY absent. The
// client sends only what a human typed — an override and the reason for it —
// and the server recomputes every defaulted value from the allowance table.
// Arithmetic that arrives from a browser is arithmetic nobody can vouch for,
// and these numbers get cut into fabric.
//
// The reason is OPTIONAL. It used to be mandatory on an overridden line, but
// the allowance itself is now editable per line, so any manufacturing figure is
// reachable by adjusting a delta — a required reason would be friction on one
// path and absent on the other. It is still captured and stored when given.
export const manufactureLineSchema = z.object({
  lineId: z.string().uuid(),
  kind: z.enum(["window", "mesh_panel"]),
  overrideWidthCm: z.number().int().positive().nullable().optional(),
  overrideHeightCm: z.number().int().positive().nullable().optional(),
  overrideReason: z.string().trim().max(500).nullable().optional(),
});

export type ManufactureLineInput = z.infer<typeof manufactureLineSchema>;

// min(1): confirming an empty order would advance it to sent_to_vendor with no
// measurements behind it.
export const confirmManufactureSchema = z.object({
  orderId: z.string().uuid(),
  lines: z.array(manufactureLineSchema).min(1),
});

// The amendment payload.
//
// Unlike the confirm payload this DOES carry manufacturing dimensions, because
// there is nothing left to derive them from: the row was frozen at
// confirmation and the point of an amendment is to replace those numbers with
// ones a person chose. The deltas are still not accepted — the action
// recomputes them against the STORED source, so source + delta = mfg keeps
// holding.
export const amendManufactureLineSchema = z.object({
  lineId: z.string().uuid(),
  mfgWidthCm: z
    .number()
    .int("Manufacturing width must be a whole number of centimetres")
    .positive("Manufacturing width must be above zero"),
  mfgHeightCm: z
    .number()
    .int("Manufacturing height must be a whole number of centimetres")
    .positive("Manufacturing height must be above zero"),
});

// A reason is mandatory, not optional-with-a-default. An amendment changes what
// a vendor is already building; the timeline note explaining why is the only
// record anyone downstream will have.
export const amendManufactureSchema = z.object({
  orderId: z.string().uuid(),
  lines: z
    .array(amendManufactureLineSchema)
    .min(1, "Change at least one measurement before amending"),
  reason: z
    .string()
    .trim()
    .min(1, "An amendment needs a reason")
    .max(500, "Keep the reason under 500 characters"),
});

export type AmendManufactureInput = z.infer<typeof amendManufactureSchema>;
