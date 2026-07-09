import { z } from "zod";

// Shared client + server. A curtain series is the "physical category" a curtain
// type belongs to; the running per-series index keys off its id.
export const curtainSeriesSchema = z.object({
  isNew: z.boolean(),
  id: z.string().uuid().optional(), // present on edit
  name: z.string().min(1, "Required").max(120),
  is_active: z.boolean().optional(),
});

export type CurtainSeriesInput = z.infer<typeof curtainSeriesSchema>;
