import { z } from "zod";

import { ROOM_TYPE_VALUES } from "./order";

// Phase 13C — what the business fills in so a 采购订单 can be generated.
//
// One rule runs through every schema here: A BLANK FIELD BECOMES NULL, NEVER "".
// NULL is the system's word for "nobody has told us this yet", and buildPos
// refuses to generate a document while any label it needs is null. An empty
// string is indistinguishable from a real answer at the database level, so it
// would sail past that refusal and print an EMPTY CELL on a cutting instruction
// headed for Shenzhen. The distinction is the safety mechanism, not tidiness.

/**
 * A field that may legitimately be unknown.
 *
 * Trims first, so " " is unknown too — a stray space is not an answer. Accepts
 * null/undefined so a form that never rendered the field behaves the same as a
 * form that rendered it empty.
 */
function optionalText(max: number, field: string) {
  return z.preprocess(
    (v) => {
      if (v == null) return null;
      if (typeof v !== "string") return v;
      const trimmed = v.trim();
      return trimmed.length === 0 ? null : trimmed;
    },
    z
      .string()
      .max(max, `${field} must be ${max} characters or fewer.`)
      .nullable(),
  );
}

/** A field the document cannot print around. */
function requiredText(max: number, field: string) {
  return z
    .string({ error: `${field} is required.` })
    .trim()
    .min(1, `${field} is required.`)
    .max(max, `${field} must be ${max} characters or fewer.`);
}

/**
 * 窗帘离地 — clearance from the floor, in whole centimetres.
 *
 * Typed on a form, so a string arrives. Blank is null: the samples print the
 * label with nothing beside it, and we do not yet know the business's answer.
 * Bounded at 100 cm because this is a hem gap, not a drop — a metre of floor
 * clearance is a typo, and a typo here is cut into fabric.
 */
const floorClearanceCm = z.preprocess(
  (v) => {
    if (v == null) return null;
    if (typeof v === "string") {
      const trimmed = v.trim();
      if (trimmed.length === 0) return null;
      // Number("") is 0 and Number("low") is NaN; the blank case is already
      // handled above, so NaN can only mean "not a number", which the schema
      // below rejects rather than silently storing.
      const n = Number(trimmed);
      return Number.isNaN(n) ? trimmed : n;
    }
    return v;
  },
  z
    .number({ error: "Floor clearance must be a whole number of centimetres." })
    .int("Floor clearance must be a whole number of centimetres.")
    .min(0, "Floor clearance must be between 0 and 100 cm.")
    .max(100, "Floor clearance must be between 0 and 100 cm.")
    .nullable(),
);

/** The singleton `procurement_settings` row, as the admin screen submits it. */
export const procurementSettingsSchema = z.object({
  // The letterhead. NOT NULL in the database and required here: a PO with no
  // company on it is not a document anyone can act on.
  companyName: requiredText(120, "Company name"),
  companyUen: requiredText(60, "UEN"),
  addressLine1: requiredText(160, "Address line 1"),
  addressLine2: requiredText(160, "Address line 2"),
  phone: requiredText(60, "Phone"),
  wechat: requiredText(60, "WeChat"),
  website: requiredText(200, "Website"),
  // 收货地址 — air freight only. Null on all four and the block is omitted.
  airShippingMark: optionalText(200, "Air shipping mark"),
  warehouseAddressCn: optionalText(400, "Warehouse address"),
  recipientCn: optionalText(120, "Recipient"),
  deliveryPhone: optionalText(60, "Delivery phone"),
  // 订单资料 — curtain POs only; blank on the Blinds sample by design.
  curtainStyleCn: optionalText(60, "Curtain style"),
  heatSettingCn: optionalText(60, "Heat setting"),
  floorClearanceCm,
});

export type ProcurementSettingsInput = z.infer<
  typeof procurementSettingsSchema
>;

/**
 * One row of `room_type_labels`: 客厅 + LR.
 *
 * `code` is required and `nameCn` is not, which mirrors the table exactly and
 * says something true: a row exists BECAUSE we know the code. Service Yard's SR
 * is evidenced by the Blinds sample while its Chinese name is not, and that
 * half-known state must be storable without anyone inventing the other half.
 */
export const roomTypeLabelSchema = z.object({
  roomType: z.enum(ROOM_TYPE_VALUES),
  nameCn: optionalText(60, "Chinese room name"),
  code: requiredText(12, "Room code"),
});

export type RoomTypeLabelInput = z.infer<typeof roomTypeLabelSchema>;

/**
 * The five coverings the CRM can record, which is the complete set of questions
 * the 窗帘款式 column asks. Matches the po_type_labels CHECK constraint.
 */
export const PO_TYPE_KEYS = ["day", "night", "toilet", "blind", "mesh"] as const;
export type PoTypeKey = (typeof PO_TYPE_KEYS)[number];

export const poTypeLabelSchema = z.object({
  key: z.enum(PO_TYPE_KEYS),
  labelCn: optionalText(60, "Type label"),
});

export type PoTypeLabelInput = z.infer<typeof poTypeLabelSchema>;

/**
 * One row of `po_opening_labels` — 开法.
 *
 * `draw` is text rather than an enum for the same reason the column is: two
 * draw-direction enums exist (curtain and mesh) and this table is a superset of
 * both. It only ever names a row that already exists.
 */
export const poOpeningLabelSchema = z.object({
  draw: requiredText(60, "Draw direction"),
  labelCn: optionalText(60, "Opening label"),
});

export type PoOpeningLabelInput = z.infer<typeof poOpeningLabelSchema>;

/**
 * `curtain_series.name_cn` — the 窗帘款式 wording for a blind.
 *
 * Per series, not per product line: 卷帘 means a ROLLER blind specifically, and
 * a Roman or Venetian blind is a different word.
 */
export const seriesNameCnSchema = z.object({
  seriesId: z.string().uuid(),
  nameCn: optionalText(60, "Chinese series name"),
});

export type SeriesNameCnInput = z.infer<typeof seriesNameCnSchema>;

/**
 * The four vendor columns the PO's 供应商 block prints.
 *
 * Kept apart from `vendorSchema` because that one feeds a React Hook Form
 * resolver, which needs a schema whose input and output types match — these
 * transform "" into null. The vendor action pipes its parsed values through
 * here so the blank-is-null rule lives in one tested place.
 *
 * None of them block generation: a vendor missing its phone number simply
 * prints one line fewer. They are contact details, not cutting instructions.
 */
export const vendorProcurementFieldsSchema = z.object({
  internal_ref: optionalText(40, "Internal ref"),
  name_cn: optionalText(120, "Chinese vendor name"),
  address_cn: optionalText(300, "Chinese vendor address"),
  phone: optionalText(60, "Vendor phone"),
});

export type VendorProcurementFields = z.infer<
  typeof vendorProcurementFieldsSchema
>;

// Han characters, the script every one of these fields is meant to be in.
const HAN = /\p{Script=Han}/u;

/**
 * Does this label actually contain Chinese?
 *
 * The admin screen warns when a stored label has none. Service Yard used to
 * hold the Latin string "Service Yard" and it would have printed those words on
 * a Chinese document — a row that LOOKS answered and is not. This is how that
 * shape is surfaced. It is a warning only: a label may legitimately mix scripts
 * (窗帘 Night does, and every sample row prints it that way), so refusing to
 * save a Latin-only string would be a guess of a different kind.
 */
export function containsChinese(value: string | null | undefined): boolean {
  return value != null && HAN.test(value);
}
