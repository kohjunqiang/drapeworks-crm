import { z } from "zod";

const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    );
  }, "Enter a valid calendar date");

const clockTime = z
  .string()
  .regex(/^\d{2}:\d{2}$/, "Use HH:MM")
  .refine((value) => {
    const [hour, minute] = value.split(":").map(Number);
    return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
  }, "Enter a valid time");

export const fulfilmentArrangementSchema = z.object({
  order_id: z.string().uuid(),
  date: calendarDate,
  time: clockTime,
  duration_mins: z.coerce.number().int().min(15).max(480).default(60),
  address: z.string().trim().min(1, "Installation address is required").max(500),
});

export const fulfilmentArrangementRetrySchema = z.object({
  order_id: z.string().uuid(),
});

export const fulfilmentArrangementCancellationSchema = z.object({
  order_id: z.string().uuid(),
  reason: z
    .string()
    .trim()
    .min(1, "Cancellation reason is required")
    .max(1000),
});

export type FulfilmentArrangementInput = z.infer<
  typeof fulfilmentArrangementSchema
>;

/**
 * Save payload for installation-detail overrides, shared by the edit dialog
 * (client-side check) and the server action (authoritative). Identifiers are
 * re-checked against the order inside the action — this schema only bounds
 * shape, size and dimensions. A blank dimension input becomes null, which
 * falls back to the original; an emptied note stays "" and explicitly clears.
 * Notes are trimmed so whitespace-only input reads as empty.
 */
const installationDimensionCm = z.preprocess(
  (value) => (value === "" || value == null ? null : value),
  z.coerce.number().positive().finite().max(100_000).nullable(),
);

export const installationDetailsInputSchema = z.object({
  token: z.string().uuid(),
  expected_version: z.coerce.number().int().min(0).max(1_000_000),
  general_instructions: z.string().trim().max(2000).nullable().optional(),
  rooms: z
    .array(
      z.object({
        room_id: z.string().uuid(),
        note: z.string().trim().max(1000),
      }),
    )
    .max(200)
    .default([]),
  openings: z
    .array(
      z.object({
        opening_id: z.string().uuid(),
        width_cm: installationDimensionCm.optional(),
        height_cm: installationDimensionCm.optional(),
        note: z.string().trim().max(1000).nullable().optional(),
      }),
    )
    .max(1000)
    .default([]),
});

export type InstallationDetailsInput = z.infer<
  typeof installationDetailsInputSchema
>;
