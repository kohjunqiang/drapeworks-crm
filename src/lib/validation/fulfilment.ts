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

export type FulfilmentArrangementInput = z.infer<
  typeof fulfilmentArrangementSchema
>;
