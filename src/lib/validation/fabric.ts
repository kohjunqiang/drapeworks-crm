import { z } from "zod";

export const fabricSchema = z.object({
  code: z
    .string()
    .regex(/^DW-[A-Z]-\d{3,}$/, "Code must look like DW-D-123"),
  name: z.string().min(1, "Required"),
  type: z.enum(["Day", "Night", "Both"]),
  supplier: z.string().optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Must be hex like #aabbcc"),
  notes: z.string().optional(),
  isNew: z.boolean().optional(),
});

export type FabricInput = z.infer<typeof fabricSchema>;
