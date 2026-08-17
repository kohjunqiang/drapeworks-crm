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
