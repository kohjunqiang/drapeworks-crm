import { z } from "zod";

// Shared client + server. A promotion is an admin-managed order-level discount
// tier, identified by a unique name. The consultant either picks a tier (which
// sets its %) or enters a custom % — both resolve to one discount on the whole
// quote. Entered as a percentage; the action converts to basis points (×100).
export const promotionSchema = z.object({
  isNew: z.boolean(),
  id: z.string().uuid().optional(), // present on edit
  name: z.string().trim().min(1, "Required").max(120),
  discountPct: z.coerce.number().min(0).max(100),
  is_active: z.boolean().optional(),
});

export type PromotionInput = z.infer<typeof promotionSchema>;
