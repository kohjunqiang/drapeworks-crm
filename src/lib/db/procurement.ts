import "server-only";

import { db } from "@/lib/db/kysely";
import type { RoomType } from "@/lib/db/schema";

// Reads for the Admin → Procurement screen, plus the generated documents one
// order's frozen-measurements screen lists. Everything configuration-shaped here
// is small and fixed-size — five type labels, three openings, ten room types —
// so each is loaded whole rather than filtered.

export type OrderPoRow = {
  id: string;
  po_number: string;
  notes: string | null;
  generated_at: Date;
  superseded_at: Date | null;
  vendor_name: string | null;
  vendor_name_cn: string | null;
};

/**
 * Every purchase order ever generated for one order, current and superseded.
 *
 * Superseded rows are INCLUDED, and that is the point: a vendor may still be
 * working from one, so "what did we send, and when did it stop being current"
 * has to be answerable from the screen. Newest first, and within one instant by
 * vendor name, so a regeneration's three documents keep a stable order rather
 * than shuffling on each render.
 */
export async function loadOrderPos(orderId: string): Promise<OrderPoRow[]> {
  return db
    .selectFrom("manufacture_pos")
    .leftJoin("vendors", "vendors.id", "manufacture_pos.vendor_id")
    .select([
      "manufacture_pos.id as id",
      "manufacture_pos.po_number as po_number",
      "manufacture_pos.notes as notes",
      "manufacture_pos.generated_at as generated_at",
      "manufacture_pos.superseded_at as superseded_at",
      "vendors.name as vendor_name",
      "vendors.name_cn as vendor_name_cn",
    ])
    .where("manufacture_pos.order_id", "=", orderId)
    .orderBy("manufacture_pos.generated_at", "desc")
    .orderBy("vendors.name", "asc")
    .execute();
}

export type ProcurementSettingsRow = {
  company_name: string;
  company_uen: string;
  address_line1: string;
  address_line2: string;
  phone: string;
  wechat: string;
  website: string;
  air_shipping_mark: string | null;
  warehouse_address_cn: string | null;
  recipient_cn: string | null;
  delivery_phone: string | null;
  curtain_style_cn: string | null;
  heat_setting_cn: string | null;
  floor_clearance_cm: number | null;
  track_note_cn: string | null;
};

/** One 收货地址. `label` is ours, for this screen — it is never printed. */
export type DeliveryVendorRow = {
  id: string;
  label: string;
  shipping_mark_cn: string | null;
  address_cn: string | null;
  recipient_cn: string | null;
  phone: string | null;
  is_default: boolean;
  is_active: boolean;
};

/**
 * Every delivery address, the default first.
 *
 * Archived rows are included and shown greyed: this screen is where you undo
 * an archive, and a row that vanished when you archived it would be a row you
 * could not get back.
 */
export async function loadDeliveryVendors(): Promise<DeliveryVendorRow[]> {
  return db
    .selectFrom("delivery_vendors")
    .select([
      "id",
      "label",
      "shipping_mark_cn",
      "address_cn",
      "recipient_cn",
      "phone",
      "is_default",
      "is_active",
    ])
    .orderBy("is_default", "desc")
    .orderBy("is_active", "desc")
    .orderBy("label", "asc")
    .execute();
}

export async function loadProcurementSettings(): Promise<ProcurementSettingsRow | null> {
  const row = await db
    .selectFrom("procurement_settings")
    .select([
      "company_name",
      "company_uen",
      "address_line1",
      "address_line2",
      "phone",
      "wechat",
      "website",
      "air_shipping_mark",
      "warehouse_address_cn",
      "recipient_cn",
      "delivery_phone",
      "curtain_style_cn",
      "heat_setting_cn",
      "floor_clearance_cm",
      "track_note_cn",
    ])
    .where("singleton", "=", true)
    .executeTakeFirst();
  return row ?? null;
}

export type RoomTypeLabelRow = {
  room_type: RoomType;
  name_cn: string | null;
  code: string;
};

/**
 * Only the room types that HAVE a row.
 *
 * Six of the ten have none, and the screen lists all ten regardless — an
 * absent row and a null name are the same state ("we do not know") and both
 * block generation, so both must be visible in the same place.
 */
export async function loadRoomTypeLabels(): Promise<RoomTypeLabelRow[]> {
  return db
    .selectFrom("room_type_labels")
    .select(["room_type", "name_cn", "code"])
    .execute();
}

export type PoTypeLabelRow = { key: string; label_cn: string | null };

export async function loadPoTypeLabels(): Promise<PoTypeLabelRow[]> {
  return db
    .selectFrom("po_type_labels")
    .select(["key", "label_cn"])
    .orderBy("key", "asc")
    .execute();
}

export type PoOpeningLabelRow = { draw: string; label_cn: string | null };

export async function loadPoOpeningLabels(): Promise<PoOpeningLabelRow[]> {
  return db
    .selectFrom("po_opening_labels")
    .select(["draw", "label_cn"])
    .orderBy("draw", "asc")
    .execute();
}

export type BlindSeriesNameRow = {
  id: string;
  name: string;
  name_cn: string | null;
  is_active: boolean;
};

/**
 * Blind series and their Chinese wording.
 *
 * Blinds only: a curtain's 窗帘款式 comes from po_type_labels (纱窗 Day /
 * 窗帘 Night), while a blind's is per series — 卷帘 is a ROLLER blind, and a
 * Roman or Venetian is a different word entirely.
 *
 * Archived series are included. An order placed before a series was archived
 * still generates a PO from it, and that document still needs the wording.
 */
export async function loadBlindSeriesNames(): Promise<BlindSeriesNameRow[]> {
  return db
    .selectFrom("curtain_series")
    .select(["id", "name", "name_cn", "is_active"])
    .where("product_line", "=", "blind")
    .orderBy("is_active", "desc")
    .orderBy("name", "asc")
    .execute();
}
