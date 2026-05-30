import { z } from "zod";

export const ROLE_VALUES = ["consultant", "ops", "admin"] as const;

export const inviteUserSchema = z.object({
  email: z.string().email("Invalid email"),
  fullName: z.string().min(1, "Required"),
  role: z.enum(ROLE_VALUES),
});

export const roleUpdateSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(ROLE_VALUES),
});

export const setActiveSchema = z.object({
  userId: z.string().uuid(),
  active: z.boolean(),
});

export type InviteUserInput = z.infer<typeof inviteUserSchema>;
