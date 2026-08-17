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
export const manufactureLineSchema = z
  .object({
    lineId: z.string().uuid(),
    kind: z.enum(["window", "mesh_panel"]),
    overrideWidthCm: z.number().int().positive().nullable().optional(),
    overrideHeightCm: z.number().int().positive().nullable().optional(),
    overrideReason: z.string().trim().max(500).nullable().optional(),
  })
  .refine(
    (v) =>
      (v.overrideWidthCm == null && v.overrideHeightCm == null) ||
      (v.overrideReason != null && v.overrideReason.length > 0),
    {
      message: "An overridden measurement needs a reason",
      path: ["overrideReason"],
    },
  );

export type ManufactureLineInput = z.infer<typeof manufactureLineSchema>;

// min(1): confirming an empty order would advance it to sent_to_vendor with no
// measurements behind it.
export const confirmManufactureSchema = z.object({
  orderId: z.string().uuid(),
  lines: z.array(manufactureLineSchema).min(1),
});
