// Zod schemas for Mesh consultations (Phase 11).
//
// Deliberately parallel to validation/order.ts rather than folded into it: a
// mesh panel and a curtain window share no product attributes, so a
// discriminated union would be two disjoint halves. The customer and order-meta
// halves ARE shared and are imported, not duplicated.
//
// product_line appears nowhere in here, by design. Which product line an order
// belongs to is decided by which server action was called — createOrder takes
// the 'curtain' column default, createMeshOrder writes 'mesh'. No schema can
// express it, so no request can change it.
//
// See docs/specs/phase-11-mesh-product-line.md §7.

import { z } from "zod";

import {
  ROOM_TYPE_VALUES,
  customerSchema,
  optionalInt,
  optionalTypeId,
  orderMetaSchema,
  optionalAppointmentId,
  optionalLeadId,
} from "./order";

const MESH_DRAWS = [
  "Single Left",
  "Single Right",
  "Single Top",
  "Single Bottom",
  "Double",
] as const;

export const MESH_DRAW_VALUES = MESH_DRAWS;

export type MeshDraw = (typeof MESH_DRAWS)[number];

/** Only a double draw splits into two leaves. */
export function meshDrawIsDouble(draw: MeshDraw | undefined): boolean {
  return draw === "Double";
}

export const meshPanelSchema = z.object({
  position: z.number().int().min(0),
  category_id: optionalTypeId,
  colour_id: optionalTypeId,
  width_cm: optionalInt,
  height_cm: optionalInt,
  // What the frame is screwed to. The mesh fixes to the window grille; an
  // opening with no window has no grille, so it goes to the wall instead.
  // Defaults to true because that is the overwhelmingly common case, and
  // unlike the measurements there is no meaningful "unset". Never affects
  // price — install is per panel regardless of mount surface.
  has_window: z.boolean().default(true),
  // The opening is set into the wall, so the panel has to fit within it — it
  // may match the measured size exactly but never exceed it. Flags, not
  // measurements: the lengths change nothing, "make it to size, no overhang"
  // does. Neither affects price.
  //
  // Split by axis because they constrain different things. Wall to the LEFT
  // and RIGHT shortens the track by the system's clearance so the panel can be
  // tilted in; wall ABOVE and BELOW constrains the height and leaves the track
  // alone.
  has_inset_horizontal: z.boolean().default(false),
  has_inset_vertical: z.boolean().default(false),
  draw: z.enum(MESH_DRAWS).optional(),
  // Double draw only. Recorded as two cm measurements rather than a preset
  // ratio so every split is expressible and the factory gets exact numbers.
  //
  // These SHOULD sum to width_cm, but a mismatch is deliberately not a
  // validation error — a consultant must never be blocked on site by a 1 cm
  // discrepancy. The form shows an amber hint; the schema accepts the values.
  split_left_cm: optionalInt,
  split_right_cm: optionalInt,
  notes: z.string().max(2000).optional(),
});

export const meshRoomSchema = z.object({
  type: z.enum(ROOM_TYPE_VALUES),
  label: z.string().min(1, "Required").max(200),
  position: z.number().int().min(0),
  panels: z.array(meshPanelSchema).min(1, "At least one panel"),
});

export const meshOrderCreateSchema = z.object({
  customer: customerSchema,
  order: orderMetaSchema,
  rooms: z.array(meshRoomSchema).min(1, "Add at least one room"),
  appointment_id: optionalAppointmentId,
  lead_id: optionalLeadId,
});

// Draft variant — mirrors orderDraftSchema: only the customer name is
// required, rooms and panels may be empty.
const customerDraftSchema = z.object({
  name: z.string().min(1, "Customer name is required").max(200),
  mobile: z
    .string()
    .max(30)
    .optional()
    .transform((v) => v ?? ""),
  email: z
    .string()
    .max(254)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
});

const meshDraftRoom = z.object({
  type: z.enum(ROOM_TYPE_VALUES),
  label: z.string().min(1).max(200),
  position: z.number().int().min(0),
  panels: z.array(meshPanelSchema),
});

export const meshOrderDraftSchema = z.object({
  customer: customerDraftSchema,
  order: orderMetaSchema,
  rooms: z.array(meshDraftRoom),
  appointment_id: optionalAppointmentId,
  lead_id: optionalLeadId,
});

// Edit variants — rooms and panels carry an optional id so the action can
// upsert existing rows and insert new ones.
//
// NOTE: the optional id enables upsert but does NOT handle removal. Deleting a
// panel in the edit form requires the keep-list reconciliation in
// actions/mesh-orders.ts, matching updateOrder's handling of `windows`.
const optionalUuid = z.string().uuid().optional();

export const meshPanelEditSchema = meshPanelSchema.extend({ id: optionalUuid });

export const meshRoomEditSchema = z.object({
  id: optionalUuid,
  type: z.enum(ROOM_TYPE_VALUES),
  label: z.string().min(1, "Required").max(200),
  position: z.number().int().min(0),
  panels: z.array(meshPanelEditSchema).min(1, "At least one panel"),
});

export const meshOrderEditSchema = z.object({
  customer: customerSchema,
  order: orderMetaSchema,
  rooms: z.array(meshRoomEditSchema).min(1, "Add at least one room"),
});

export type MeshPanelInput = z.infer<typeof meshPanelSchema>;
export type MeshRoomInput = z.infer<typeof meshRoomSchema>;
export type MeshOrderCreateInput = z.infer<typeof meshOrderCreateSchema>;
export type MeshOrderDraftInput = z.infer<typeof meshOrderDraftSchema>;
export type MeshPanelEditInput = z.infer<typeof meshPanelEditSchema>;
export type MeshRoomEditInput = z.infer<typeof meshRoomEditSchema>;
export type MeshOrderEditInput = z.infer<typeof meshOrderEditSchema>;
