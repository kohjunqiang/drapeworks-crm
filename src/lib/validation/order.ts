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

const optionalInt = z.preprocess(
  (v) => {
    if (v === "" || v === undefined || v === null) return null;
    if (typeof v === "string") {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    }
    return v;
  },
  z.number().int().positive().nullable(),
);

const baseWindow = z.object({
  position: z.number().int().min(0),
  width_cm: optionalInt,
  height_cm: optionalInt,
  install_width_cm: optionalInt,
  notes: z.string().optional(),
});

const regularWindow = baseWindow.extend({
  variant: z.literal("regular"),
  day_curtain_code: z.string().optional(),
  night_curtain_code: z.string().optional(),
  draw: z.enum(DRAW_DIRECTIONS).optional(),
});

const toiletWindow = baseWindow.extend({
  variant: z.literal("toilet"),
  curtain_code: z.string().optional(),
});

export const windowSchema = z.discriminatedUnion("variant", [
  regularWindow,
  toiletWindow,
]);

export const roomSchema = z.object({
  type: z.enum(ROOM_TYPES),
  label: z.string().min(1, "Required"),
  position: z.number().int().min(0),
  windows: z.array(windowSchema).min(1, "At least one window"),
});

const customerSchema = z.object({
  name: z.string().min(1, "Required"),
  mobile: z.string().min(1, "Required"),
  email: z
    .string()
    .email("Invalid email")
    .or(z.literal(""))
    .optional()
    .transform((v) => (v === "" ? undefined : v)),
});

const orderMetaSchema = z.object({
  property_type: z
    .enum(PROPERTY_TYPES)
    .or(z.literal(""))
    .optional()
    .transform((v) => (v === "" || v === undefined ? undefined : v)),
  development: z.string().optional(),
  unit_type: z.string().optional(),
  move_in_date: z
    .string()
    .optional()
    .transform((v) => (v === "" ? undefined : v)),
  price_quoted_cents: z.coerce.number().int().min(0).default(0),
  deposit_cents: z.coerce.number().int().min(0).default(0),
  general_notes: z.string().optional(),
  is_draft: z.boolean().default(false),
});

export const orderCreateSchema = z.object({
  customer: customerSchema,
  order: orderMetaSchema,
  rooms: z.array(roomSchema).min(1, "Add at least one room"),
});

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
  label: z.string().min(1, "Required"),
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
