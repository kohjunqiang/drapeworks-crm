import { z } from "zod";

// Shared client + server. A vendor is a curtain supplier, identified by a
// unique name plus the system's id (uuid). The pricing feature attaches a
// chosen vendor to each curtain series.
export const vendorSchema = z.object({
  isNew: z.boolean(),
  id: z.string().uuid().optional(), // present on edit
  name: z.string().trim().min(1, "Required").max(120),
  notes: z.string().trim().max(500).optional(),
  is_active: z.boolean().optional(),
});

export type VendorInput = z.infer<typeof vendorSchema>;
