import { MAX_BEAD_COUNT } from "@/lib/manufacture/sfold-beads";
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

// S-fold bead counts are positive EVEN integers — runners space at 6 cm per
// side and the vendor supplies them in pairs. A single draw sends one count,
// a double draw a left and a right; the shape itself is enforced against the
// window's stored draw in the actions, which derive it rather than trusting
// the payload.
const beadCount = z
  .number()
  .int("A bead count must be a whole number")
  .max(MAX_BEAD_COUNT, "The bead count is too large")
  .multipleOf(2, "A bead count must be even — runners come in pairs")
  .positive("A bead count must be above zero");

const beadFields = {
  sFoldBeadCount: beadCount.nullable().optional(),
  sFoldBeadLeft: beadCount.nullable().optional(),
  sFoldBeadRight: beadCount.nullable().optional(),
};

// A line carries one count OR a left/right pair, never a mix and never half a
// pair — which of the two is legitimate is checked against the stored draw.
function refineBeadShape(
  line: {
    sFoldBeadCount?: number | null;
    sFoldBeadLeft?: number | null;
    sFoldBeadRight?: number | null;
  },
  context: z.RefinementCtx,
) {
  const hasSingle = line.sFoldBeadCount != null;
  const hasLeft = line.sFoldBeadLeft != null;
  const hasRight = line.sFoldBeadRight != null;
  if (hasSingle && (hasLeft || hasRight)) {
    context.addIssue({
      code: "custom",
      message: "Send either one bead count or a left/right pair, not both",
    });
  } else if (hasLeft !== hasRight) {
    context.addIssue({
      code: "custom",
      message: "Enter both the left and right bead counts",
    });
  }
}

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
  overrideWidthCm: z.number().multipleOf(0.01).positive().nullable().optional(),
  overrideHeightCm: z.number().multipleOf(0.01).positive().nullable().optional(),
  mfgSplitLeftCm: z.number().multipleOf(0.01).positive().nullable().optional(),
  mfgSplitRightCm: z.number().multipleOf(0.01).positive().nullable().optional(),
  overrideReason: z.string().trim().max(500).nullable().optional(),
  ...beadFields,
}).superRefine((line, context) => {
  if ((line.mfgSplitLeftCm == null) !== (line.mfgSplitRightCm == null)) {
    context.addIssue({
      code: "custom",
      message: "Enter both the left and right PO split",
    });
  }
  refineBeadShape(line, context);
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
    .multipleOf(0.01, "Use up to 2 decimal places")
    .positive("Manufacturing width must be above zero"),
  mfgHeightCm: z
    .number()
    .multipleOf(0.01, "Use up to 2 decimal places")
    .positive("Manufacturing height must be above zero"),
  mfgSplitLeftCm: z.number().multipleOf(0.01).positive().nullable().optional(),
  mfgSplitRightCm: z.number().multipleOf(0.01).positive().nullable().optional(),
  ...beadFields,
}).superRefine((line, context) => {
  const hasLeft = line.mfgSplitLeftCm != null;
  const hasRight = line.mfgSplitRightCm != null;
  if (hasLeft !== hasRight) {
    context.addIssue({
      code: "custom",
      message: "Enter both the left and right PO split",
    });
  } else if (
    hasLeft &&
    Math.abs(line.mfgSplitLeftCm! + line.mfgSplitRightCm! - line.mfgWidthCm) > 0.000001
  ) {
    context.addIssue({
      code: "custom",
      message: "The PO split must add up to the manufacturing width",
    });
  }
  // Omitted bead fields preserve the stored counts; submitted ones replace.
  refineBeadShape(line, context);
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
