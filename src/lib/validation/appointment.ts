import { z } from "zod";

// Either an existing customer is chosen, or a new one is described. Never both,
// never neither — a discriminated union makes the impossible state unspellable.
const customerRef = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("existing"), customer_id: z.string().uuid() }),
  z.object({
    mode: z.literal("new"),
    name: z.string().trim().min(1, "Customer name is required").max(200),
    // Required, because customers.mobile is NOT NULL. Worth knowing before you
    // build the form: 146 of 244 leads have no mobile, so for most leads the
    // consultant must type one at booking. Mark the field required in the
    // picker rather than letting the server action be the first thing to say so.
    mobile: z.string().trim().min(1, "Mobile is required").max(40),
    email: z.string().trim().email().optional().or(z.literal("")),
  }),
]);

export const appointmentCreateSchema = z.object({
  lead_id: z.string().uuid(),
  consultant_id: z.string().uuid("Select a consultant"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
  time: z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM"),
  duration_mins: z.coerce.number().int().min(15).max(480).default(90),
  development: z.string().trim().max(200).optional(),
  address: z.string().trim().max(500).optional(),
  notes: z.string().trim().max(2000).optional(),
  customer: customerRef,
});

export const appointmentRescheduleSchema = z.object({
  id: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  duration_mins: z.coerce.number().int().min(15).max(480),
});

export const appointmentStatusSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["scheduled", "completed", "cancelled", "no_show"]),
});

export type AppointmentCreateInput = z.infer<typeof appointmentCreateSchema>;
