import { z } from "zod";

import { CURTAIN_HEIGHT_PREFERENCES } from "@/lib/curtain-height-preference";
import { canonicalizePhone } from "@/lib/phone";

const ROOM_TYPES = [
  "Living Room",
  "Master Bedroom",
  "Bedroom",
  "Master Toilet",
  "Common Toilet",
  "Kitchen",
  "Study Room",
  "Balcony",
  // Phase 13C — a standard HDB feature the enum was missing, and the room the
  // Blinds sample PO is for. Must stay in step with public.room_type.
  "Service Yard",
  "Other",
] as const;

const PROPERTY_TYPES = ["HDB", "Condo", "Landed", "Commercial"] as const;
const DRAW_DIRECTIONS = ["Double", "Single Left", "Single Right"] as const;

export const ROOM_TYPE_VALUES = ROOM_TYPES;
export const PROPERTY_TYPE_VALUES = PROPERTY_TYPES;
export const DRAW_DIRECTION_VALUES = DRAW_DIRECTIONS;

/**
 * Since Phase 14 this means "this room's windows are blinds". It no longer
 * selects a window VARIANT — the single-curtain toilet variant is gone — it
 * decides which covering is on offer.
 */
export function isToiletRoom(type: (typeof ROOM_TYPES)[number]): boolean {
  return type === "Master Toilet" || type === "Common Toilet";
}

// Curtain measurements rarely exceed a few metres; cap at 1000 cm (10 m) to
// stop typo-driven nonsense like 100000 cm.
const MAX_MEASUREMENT_CM = 1000;

// Exported so the mesh schemas (validation/mesh.ts) reuse the exact same
// coercion rules rather than duplicating them. No behaviour change here.
export const optionalInt = z.preprocess(
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
export const optionalTypeId = z.preprocess(
  (v) => (v === "" || v === null ? undefined : v),
  z.string().uuid().optional(),
);

// One saved curtain drop per curtain window. "" (an unchosen select), an
// absent key and an explicit null all normalise to null — "no saved drop, use
// the configured allowance" — so a legacy window round-trips its historic
// basis instead of silently gaining a preference.
const curtainHeightPreference = z.preprocess(
  (v) => (v === "" || v === undefined || v === null ? null : v),
  z.enum(CURTAIN_HEIGHT_PREFERENCES).nullable(),
);

const baseWindow = z.object({
  position: z.number().int().min(0),
  // When the consultation was seeded from a previous order, the window whose
  // detail photos should be cloned onto this new row. The action constrains
  // it to the same customer + product line before copying.
  template_window_id: z.string().uuid().optional(),
  // Editable location label. Blank stores null and every downstream document
  // falls back to the legacy "Window N" wording.
  label: z.string().trim().max(120).optional(),
  // Form-local key stamped on a not-yet-persisted window so its pending detail
  // photos keep their identity through add/remove/draft-restore. Never stored.
  client_key: z.string().max(64).optional(),
  width_cm: optionalInt,
  height_cm: optionalInt,
  notes: z.string().max(2000).optional(),
  side_installation: z.boolean().default(false),
  // Per-window opt-out of the automatic handyman cost. Distinct from "No
  // tracks": a window can keep its rail and still waive installation.
  no_installation: z.boolean().default(false),
  // Which add-ons are ticked. The server re-resolves this against the
  // catalogue before persisting (lib/actions/orders.ts), so a payload cannot
  // attach an out-of-scope, archived or unpriced add-on by asserting it.
  addon_ids: z.array(z.string().uuid()).default([]),
});

const regularWindow = baseWindow.extend({
  variant: z.literal("regular"),
  // The form selects photo-backed curtain *types* (Phase 8, "Option A").
  day_curtain_type_id: optionalTypeId,
  night_curtain_type_id: optionalTypeId,
  draw: z.enum(DRAW_DIRECTIONS).optional(),
  // Optional because an ordinary double draw still defaults to an equal split.
  // Supplying either side opts into an off-centre meeting point.
  split_left_cm: optionalInt,
  split_right_cm: optionalInt,
  // Explicitly-picked combo (Phase 10) — fixes this window's sale price.
  combo_id: optionalTypeId,
  overlap_tracks_attachment: z.boolean().default(false),
  day_track_required: z.boolean().optional(),
  night_track_required: z.boolean().optional(),
  // One drop shared by the day and night curtains on this window; null keeps
  // the configured manufacturing allowance (legacy windows).
  curtain_height_preference: curtainHeightPreference,
});

// A blind's chain/control side. "Double" is a curtain concept — two leaves
// meeting in the middle — so it is not offered. The column is shared with
// curtains, hence the same "Single Left"/"Single Right" spellings.
export const BLIND_CONTROL_SIDES = ["Single Left", "Single Right"] as const;

// Blinds occupy a window INSTEAD of curtains. There is deliberately no
// day/night field here: "curtains or blinds, never both" is enforced by the
// shape of the type, not by a runtime guard someone can forget to call. The
// database's validate_window_shape() trigger enforces the same invariant
// independently.
//
// One blind variant serves every room type — including toilets, which since
// Phase 14 take a blind and nothing else. The single-curtain `toilet` variant
// modelled a product the business no longer sells and was retired with it.
const blindWindow = baseWindow.extend({
  variant: z.literal("blind"),
  blind_type_id: optionalTypeId,
  draw: z.enum(BLIND_CONTROL_SIDES).optional(),
});

// Track-only: a rail supplied and installed over a window that gets NO
// covering. It lives in the same card as a curtain window — the consultant
// ticks it where fabric would be picked — but it carries no fabric fields at
// all, the same way a blind never carries day/night. Installation is the only
// charge, so the contradictory no_installation opt-out is pinned to literal
// false — present on the union for downstream code, rejected if asserted.
const trackOnlyWindow = baseWindow.extend({
  variant: z.literal("track"),
  no_installation: z.literal(false).default(false),
  track_kind: z.enum(["single", "double"]),
  overlap_tracks_attachment: z.boolean().default(false),
});

function validateCurtainSplit(
  win: {
    variant: "regular" | "blind" | "track";
    draw?: (typeof DRAW_DIRECTIONS)[number];
    width_cm?: number | null;
    split_left_cm?: number | null;
    split_right_cm?: number | null;
  },
  ctx: z.RefinementCtx,
) {
  if (win.variant !== "regular") return;
  const left = win.split_left_cm ?? null;
  const right = win.split_right_cm ?? null;
  if (left == null && right == null) return;

  // Changing Double to a single draw hides these inputs. Treat any stale form
  // values as irrelevant; windowValues() clears them before persistence.
  if (win.draw !== "Double") return;
  if (left == null || right == null) {
    ctx.addIssue({
      code: "custom",
      path: [left == null ? "split_left_cm" : "split_right_cm"],
      message: "Enter both the left and right widths",
    });
    return;
  }
  if (win.width_cm == null || left + right !== win.width_cm) {
    ctx.addIssue({
      code: "custom",
      path: ["split_right_cm"],
      message: "Left and right widths must add up to the total width",
    });
  }
}

export const windowSchema = z
  .discriminatedUnion("variant", [regularWindow, blindWindow, trackOnlyWindow])
  .superRefine(validateCurtainSplit);

export const roomSchema = z.object({
  template_room_id: z.string().uuid().optional(),
  type: z.enum(ROOM_TYPES),
  label: z.string().min(1, "Required").max(200),
  position: z.number().int().min(0),
  windows: z.array(windowSchema).min(1, "At least one window"),
});

// Customer phone. Singapore numbers are 8 digits starting with 3 (VoIP),
// 6 (landline), 8 or 9 (mobile); foreign numbers carry an explicit country
// code ("+" or "00") or are already canonicalised to E.164 by the country
// picker. libphonenumber-js validates by possible length rather than exact
// allocated ranges, so a well-shaped number in a new block still saves.
// The stored value is canonical E.164 — a foreign number is never coerced
// into a Singapore one, and a "+65" prefix never gets doubled.
const customerPhone = z
  .string()
  .min(1, "Required")
  .max(30)
  .transform((v, ctx) => {
    const canonical = canonicalizePhone(v, "SG");
    if (canonical === null) {
      ctx.addIssue({
        code: "custom",
        message: "Enter a valid number — 8-digit Singapore (e.g. 9123 4567) or international with country code (e.g. +60 12 345 6789)",
      });
      return z.NEVER;
    }
    return canonical;
  });

export const customerSchema = z.object({
  // Optional title, separate from the name and never guessed. Capped at 25 —
  // the Zoho Books salutation limit — so any stored value can be pushed.
  salutation: z
    .string()
    .trim()
    .max(25, "Title must be 25 characters or fewer")
    .optional(),
  name: z.string().min(1, "Required").max(200),
  mobile: customerPhone,
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

export const orderMetaSchema = z.object({
  property_type: z
    .enum(PROPERTY_TYPES)
    .or(z.literal(""))
    .optional()
    .transform((v) => (v === "" || v === undefined ? undefined : v)),
  development: z.string().max(200).optional(),
  site_address: z.string().max(500).optional(),
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
  // Pricing selectors (Phase 9) read by the quote calculator.
  freight_mode: z.enum(["air", "sea"]).default("air"),
  channel: z.enum(["standard", "carousell"]).default("standard"),
  // Ad-hoc extra install cost (transport etc), SGD cents.
  extra_install_cents: z.coerce
    .number()
    .int()
    .min(0)
    .max(MAX_MONEY_CENTS)
    .default(0),
  // Applied promotion (Phase 10), denormalised for reproducibility.
  // discount_bps in basis points (15% → 1500); promo_label names the tier
  // (null for a custom % or no promo).
  discount_bps: z.coerce.number().int().min(0).max(10000).default(0),
  promo_label: z
    .string()
    .max(120)
    .optional()
    .transform((v) => (v === "" || v === undefined ? undefined : v)),
  curtain_package_id: z.string().uuid().optional().or(z.literal("")).transform((v) => v || undefined),
  curtain_package_tier: z.enum(["essential", "tier2"]).default("essential"),
  curtain_package_single_layer: z.enum(["day", "night"]).default("night"),
  curtain_package_pricing_signature: z.string().max(10000).optional(),
});

// Phase 15 — set when the consultation was started from a booked appointment
// (/orders/new?appointmentId=…). It is not a field the consultant fills: it
// rides along so the order records where it came from, and so the write path
// can reuse the appointment's customer instead of inserting a second row for
// the same person.
export const optionalAppointmentId = z.string().uuid().optional();
export const optionalLeadId = z.string().uuid().optional();
export const optionalCustomerId = z.string().uuid().optional();

// Business rule: an order that goes ahead — anything that isn't a draft —
// must have an installation address. Create schemas enforce it structurally
// through this field; edit schemas enforce it via
// requireSiteAddressWhenNotDraft so a saved draft may stay blank until it is
// submitted.
export const requiredSiteAddress = z
  .string()
  .trim()
  .min(1, "Installation address is required")
  .max(500);

// Adds "Installation address is required" at ["order","site_address"] — the
// exact path react-hook-form renders under errors.order.site_address — when a
// non-draft order carries a blank address. is_draft defaults to false, so an
// unstated flag counts as a submit.
export function requireSiteAddressWhenNotDraft(
  value: { order: { is_draft: boolean; site_address?: string } },
  ctx: z.RefinementCtx,
): void {
  if (!value.order.is_draft && !value.order.site_address?.trim()) {
    ctx.addIssue({
      code: "custom",
      path: ["order", "site_address"],
      message: "Installation address is required",
    });
  }
}

export const orderCreateSchema = z.object({
  customer: customerSchema,
  order: orderMetaSchema.extend({
    site_address: requiredSiteAddress,
  }),
  rooms: z.array(roomSchema).min(1, "Add at least one room"),
  appointment_id: optionalAppointmentId,
  lead_id: optionalLeadId,
  customer_id: optionalCustomerId,
});

// Draft variant: relaxed validation so consultants can persist a half-finished
// consultation without filling every field. Only customer.name is required;
// mobile and other strict checks are dropped; rooms can be empty.
const customerDraftSchema = z.object({
  salutation: z.string().trim().max(25).optional(),
  name: z.string().min(1, "Customer name is required").max(200),
  // Draft mobile is relaxed like the lead paths: canonicalised when readable
  // as a number, kept verbatim otherwise, blank stays "".
  mobile: z.string().max(30).optional().transform((v) => (v ? canonicalizePhone(v) ?? v : "")),
  email: z
    .string()
    .max(254)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
});

// Drafts are deliberately permissive — a half-filled window must survive an
// autosave — so this is a flat shape rather than a union. `blind` is included
// because saveDraft must PRESERVE a blind variant rather than derive it from
// the room type; deriving would silently discard blind_type_id on every save.
const draftWindow = baseWindow.extend({
  variant: z.enum(["regular", "blind", "track"]),
  day_curtain_type_id: optionalTypeId,
  night_curtain_type_id: optionalTypeId,
  blind_type_id: optionalTypeId,
  track_kind: z.enum(["single", "double"]).optional(),
  draw: z.enum(DRAW_DIRECTIONS).optional(),
  split_left_cm: optionalInt,
  split_right_cm: optionalInt,
  combo_id: optionalTypeId,
  overlap_tracks_attachment: z.boolean().default(false),
  day_track_required: z.boolean().optional(),
  night_track_required: z.boolean().optional(),
  curtain_height_preference: curtainHeightPreference,
});

const draftRoom = z.object({
  template_room_id: z.string().uuid().optional(),
  type: z.enum(ROOM_TYPES),
  label: z.string().min(1).max(200),
  position: z.number().int().min(0),
  windows: z.array(draftWindow),
});

export const orderDraftSchema = z.object({
  customer: customerDraftSchema,
  order: orderMetaSchema,
  rooms: z.array(draftRoom),
  // A half-finished consultation started from an appointment is still that
  // appointment's consultation — the draft path reuses the booked customer for
  // the same reason the full save does.
  appointment_id: optionalAppointmentId,
  lead_id: optionalLeadId,
  customer_id: optionalCustomerId,
});

export type OrderDraftInput = z.infer<typeof orderDraftSchema>;

export type OrderCreateInput = z.infer<typeof orderCreateSchema>;
export type RoomInput = z.infer<typeof roomSchema>;
export type WindowInput = z.infer<typeof windowSchema>;

// Edit variants — rooms and windows carry an optional id so the action can
// upsert existing rows and insert new ones.
const optionalUuid = z.string().uuid().optional();

const regularWindowEdit = regularWindow.extend({ id: optionalUuid });
const blindWindowEdit = blindWindow.extend({ id: optionalUuid });
const trackOnlyWindowEdit = trackOnlyWindow.extend({ id: optionalUuid });

export const windowEditSchema = z
  .discriminatedUnion("variant", [
    regularWindowEdit,
    blindWindowEdit,
    trackOnlyWindowEdit,
  ])
  .superRefine(validateCurtainSplit);

export const roomEditSchema = z.object({
  id: optionalUuid,
  template_room_id: optionalUuid,
  type: z.enum(ROOM_TYPES),
  label: z.string().min(1, "Required").max(200),
  position: z.number().int().min(0),
  windows: z.array(windowEditSchema).min(1, "At least one window"),
});

export const orderEditSchema = z
  .object({
    customer: customerSchema,
    order: orderMetaSchema,
    rooms: z.array(roomEditSchema).min(1, "Add at least one room"),
  })
  .superRefine(requireSiteAddressWhenNotDraft);

export type OrderEditInput = z.infer<typeof orderEditSchema>;
export type RoomEditInput = z.infer<typeof roomEditSchema>;
export type WindowEditInput = z.infer<typeof windowEditSchema>;

// Phase 13A — the vendor/delivery-facing identifier. Blank input clears it
// rather than storing an empty string, so the partial unique index only ever
// sees real values.
export const orderReferenceSchema = z.object({
  orderId: z.string().uuid(),
  reference: z
    .string()
    .max(64, "Reference must be 64 characters or fewer")
    .nullable()
    .transform((v) => {
      const trimmed = v?.trim() ?? "";
      return trimmed.length > 0 ? trimmed : null;
    }),
});
