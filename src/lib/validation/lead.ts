import { z } from "zod";

import { FUNNEL_STAGES, LEAD_OUTCOMES, LEAD_STATUSES } from "@/lib/leads/types";

const optionalText = z
  .string()
  .trim()
  .max(2000)
  .optional()
  .transform((v) => (v === "" ? undefined : v));

export const leadCreateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  mobile: optionalText,
  development: optionalText,
  // No cast: the tuples in leads/types.ts are `as const`, so these infer as
  // literal unions rather than widening to string.
  funnel_stage: z.enum(FUNNEL_STAGES),
  lead_status: z.enum(LEAD_STATUSES),
  last_outcome: z.enum(LEAD_OUTCOMES).optional(),
  action_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
    .optional(),
  action_detail_override: optionalText,
  interaction_summary: optionalText,
  // Dollars in the form, integer cents in the database.
  //
  // Preprocessed like validation/order.ts's optionalInt, and for the same
  // reason: an untouched <input type="number"> submits "", and z.coerce alone
  // turns that into 0 (Number("") === 0), which would write a phantom S$0.00
  // quote onto a lead that was never quoted. "" and whitespace mean absent;
  // a typed "0" is a real zero and must survive.
  // `null` is folded in too: it coerces to 0 by the identical route, and a
  // JSON payload is as entitled to say "no quote" as a form is.
  latest_quote_sgd: z.preprocess(
    (v) =>
      v === null || (typeof v === "string" && v.trim() === "") ? undefined : v,
    z.coerce.number().min(0).max(1_000_000).optional(),
  ),
  buying_readiness: optionalText,
  keys_status: optionalText,
  expected_key_date: optionalText,
});

export const leadUpdateSchema = leadCreateSchema.extend({
  id: z.string().uuid(),
});

export type LeadCreateInput = z.infer<typeof leadCreateSchema>;
export type LeadUpdateInput = z.infer<typeof leadUpdateSchema>;
