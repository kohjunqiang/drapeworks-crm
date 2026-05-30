import { z } from "zod";

export const fabricSchema = z.object({
  code: z
    .string()
    .regex(/^DW-[A-Z]-\d{3,}$/, "Code must look like DW-D-123")
    .max(32),
  name: z.string().min(1, "Required").max(200),
  type: z.enum(["Day", "Night", "Both"]),
  supplier: z.string().max(200).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Must be hex like #aabbcc"),
  notes: z.string().max(2000).optional(),
  isNew: z.boolean().optional(),
});

export type FabricInput = z.infer<typeof fabricSchema>;
