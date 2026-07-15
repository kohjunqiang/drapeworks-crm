import { z } from "zod";

const ROOM_TYPES = [
  "Living Room",
  "Master Bedroom",
  "Bedroom",
  "Master Toilet",
  "Common Toilet",
  "Kitchen",
  "Study Room",
  "Balcony",
  "Other",
] as const;

const PROPERTY_TYPES = ["HDB", "Condo", "Landed", "Commercial"] as const;
const DRAW_DIRECTIONS = ["Double", "Single Left", "Single Right"] as const;

export const ROOM_TYPE_VALUES = ROOM_TYPES;
export const PROPERTY_TYPE_VALUES = PROPERTY_TYPES;
export const DRAW_DIRECTION_VALUES = DRAW_DIRECTIONS;

export function isToiletRoom(type: (typeof ROOM_TYPES)[number]): boolean {
  return type === "Master Toilet" || type === "Common Toilet";
}

// Curtain measurements rarely exceed a few metres; cap at 1000 cm (10 m) to
// stop typo-driven nonsense like 100000 cm.
const MAX_MEASUREMENT_CM = 1000;

const optionalInt = z.preprocess(
  (v) => {
    if (v === "" || v === undefined || v === null) return null;
    if (typeof v === "string") {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    }
    return v;
  },
  z.number().int().positive().max(MAX_MEASUREMENT_CM).nullable(),
);

// A native <select>'s empty option submits "", which is not a valid uuid.
// Normalise "" / null to undefined so an unselected curtain type is simply
// "no selection" rather than a validation error.
const optionalTypeId = z.preprocess(
  (v) => (v === "" || v === null ? undefined : v),
  z.string().uuid().optional(),
);

const baseWindow = z.object({
  position: z.number().int().min(0),
  width_cm: optionalInt,
  height_cm: optionalInt,
  install_width_cm: optionalInt,
  notes: z.string().max(2000).optional(),
});

const regularWindow = baseWindow.extend({
  variant: z.literal("regular"),
  // The form selects photo-backed curtain *types* (Phase 8, "Option A").
  day_curtain_type_id: optionalTypeId,
  night_curtain_type_id: optionalTypeId,
  draw: z.enum(DRAW_DIRECTIONS).optional(),
  // Per-window pricing toggles (Phase 9). Fullness is fixed at 2×.
  add_s_fold: z.boolean().optional(),
  add_slim_tracks: z.boolean().optional(),
});

const toiletWindow = baseWindow.extend({
  variant: z.literal("toilet"),
  curtain_type_id: optionalTypeId,
});

export const windowSchema = z.discriminatedUnion("variant", [
  regularWindow,
  toiletWindow,
]);

export const roomSchema = z.object({
  type: z.enum(ROOM_TYPES),
  label: z.string().min(1, "Required").max(200),
  position: z.number().int().min(0),
  windows: z.array(windowSchema).min(1, "At least one window"),
});

// Singapore phone: 8 digits starting with 3 (VoIP), 6 (landline), 8 or 9
// (mobile). Accepts optional +65 prefix and any spaces, dashes, or
// parentheses between digits. Strips formatting before checking.
const sgPhone = z
  .string()
  .min(1, "Required")
  .max(30)
  .transform((v) => v.replace(/[\s\-()]/g, ""))
  .pipe(
    z
      .string()
      .regex(
        /^(\+65)?[3689]\d{7}$/,
        "Enter an 8-digit Singapore number (e.g. 9123 4567)",
      ),
  );

const customerSchema = z.object({
  name: z.string().min(1, "Required").max(200),
  mobile: sgPhone,
  email: z
    .string()
    .email("Invalid email")
    .max(254)
    .or(z.literal(""))
    .optional()
    .transform((v) => (v === "" ? undefined : v)),
});

// Sanity cap on money values: SGD 1,000,000 — a curtain order doesn't get
// anywhere near this. Stops accidental extra zero typos from polluting stats.
const MAX_MONEY_CENTS = 100_000_000;

const orderMetaSchema = z.object({
  property_type: z
    .enum(PROPERTY_TYPES)
    .or(z.literal(""))
    .optional()
    .transform((v) => (v === "" || v === undefined ? undefined : v)),
  development: z.string().max(200).optional(),
  unit_type: z.string().max(100).optional(),
  move_in_date: z
    .string()
    .optional()
    .transform((v) => (v === "" ? undefined : v))
    .refine(
      (v) => v === undefined || /^\d{4}-\d{2}-\d{2}$/.test(v),
      "Date must look like YYYY-MM-DD",
    ),
  price_quoted_cents: z.coerce
    .number()
    .int()
    .min(0)
    .max(MAX_MONEY_CENTS)
    .default(0),
  deposit_cents: z.coerce
    .number()
    .int()
    .min(0)
    .max(MAX_MONEY_CENTS)
    .default(0),
  general_notes: z.string().max(2000).optional(),
  is_draft: z.boolean().default(false),
});

export const orderCreateSchema = z.object({
  customer: customerSchema,
  order: orderMetaSchema,
  rooms: z.array(roomSchema).min(1, "Add at least one room"),
});

// Draft variant: relaxed validation so consultants can persist a half-finished
// consultation without filling every field. Only customer.name is required;
// mobile and other strict checks are dropped; rooms can be empty.
const customerDraftSchema = z.object({
  name: z.string().min(1, "Customer name is required").max(200),
  mobile: z.string().max(30).optional().transform((v) => v ?? ""),
  email: z
    .string()
    .max(254)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
});

const draftWindow = baseWindow.extend({
  variant: z.enum(["regular", "toilet"]),
  curtain_type_id: optionalTypeId,
  day_curtain_type_id: optionalTypeId,
  night_curtain_type_id: optionalTypeId,
  draw: z.enum(DRAW_DIRECTIONS).optional(),
});

const draftRoom = z.object({
  type: z.enum(ROOM_TYPES),
  label: z.string().min(1).max(200),
  position: z.number().int().min(0),
  windows: z.array(draftWindow),
});

export const orderDraftSchema = z.object({
  customer: customerDraftSchema,
  order: orderMetaSchema,
  rooms: z.array(draftRoom),
});

export type OrderDraftInput = z.infer<typeof orderDraftSchema>;

export type OrderCreateInput = z.infer<typeof orderCreateSchema>;
export type RoomInput = z.infer<typeof roomSchema>;
export type WindowInput = z.infer<typeof windowSchema>;

// Edit variants — rooms and windows carry an optional id so the action can
// upsert existing rows and insert new ones.
const optionalUuid = z.string().uuid().optional();

const regularWindowEdit = regularWindow.extend({ id: optionalUuid });
const toiletWindowEdit = toiletWindow.extend({ id: optionalUuid });

export const windowEditSchema = z.discriminatedUnion("variant", [
  regularWindowEdit,
  toiletWindowEdit,
]);

export const roomEditSchema = z.object({
  id: optionalUuid,
  type: z.enum(ROOM_TYPES),
  label: z.string().min(1, "Required").max(200),
  position: z.number().int().min(0),
  windows: z.array(windowEditSchema).min(1, "At least one window"),
});

export const orderEditSchema = z.object({
  customer: customerSchema,
  order: orderMetaSchema,
  rooms: z.array(roomEditSchema).min(1, "Add at least one room"),
});

export type OrderEditInput = z.infer<typeof orderEditSchema>;
export type RoomEditInput = z.infer<typeof roomEditSchema>;
export type WindowEditInput = z.infer<typeof windowEditSchema>;
