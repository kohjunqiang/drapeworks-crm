import "server-only";

import type { Kysely, Transaction } from "kysely";

import type { DB } from "@/lib/db/schema";

import {
  SHIPMENT_CATEGORIES,
  shipmentCategoriesForOrder,
  type ShipmentCategory,
  type ShipmentValues,
} from "./shipments";

type Executor = Kysely<DB> | Transaction<DB>;

export async function deriveShipmentCategories(
  executor: Executor,
  orderId: string,
): Promise<ShipmentCategory[]> {
  const order = await executor.selectFrom("orders")
    .select("product_line")
    .where("id", "=", orderId)
    .executeTakeFirst();
  if (!order) return [];

  if (order.product_line === "mesh") {
    const panel = await executor.selectFrom("mesh_panels")
      .innerJoin("rooms", "rooms.id", "mesh_panels.room_id")
      .select("mesh_panels.id")
      .where("rooms.order_id", "=", orderId)
      .executeTakeFirst();
    return shipmentCategoriesForOrder("mesh", [], Boolean(panel));
  }

  const rows = await executor.selectFrom("windows")
    .innerJoin("rooms", "rooms.id", "windows.room_id")
    .leftJoin("window_addons", "window_addons.window_id", "windows.id")
    .leftJoin("pricing_addons", "pricing_addons.id", "window_addons.addon_id")
    .select([
      "windows.id",
      "windows.day_curtain_type_id",
      "windows.night_curtain_type_id",
      "windows.blind_type_id",
      "windows.overlap_tracks_attachment",
      "pricing_addons.key as addon_key",
    ])
    .where("rooms.order_id", "=", orderId)
    .execute();

  const windows = new Map<string, {
    hasCurtain: boolean;
    hasBlind: boolean;
    hasSFold: boolean;
    hasOverlap: boolean;
  }>();
  for (const row of rows) {
    const current = windows.get(row.id) ?? {
      hasCurtain: Boolean(row.day_curtain_type_id || row.night_curtain_type_id),
      hasBlind: Boolean(row.blind_type_id),
      hasSFold: false,
      hasOverlap: row.overlap_tracks_attachment,
    };
    if (row.addon_key === "s_fold") current.hasSFold = true;
    windows.set(row.id, current);
  }

  return shipmentCategoriesForOrder("curtain", [...windows.values()]);
}

export async function materializeShipmentManifest(
  executor: Transaction<DB>,
  orderId: string,
): Promise<ShipmentCategory[]> {
  const existing = await executor.selectFrom("order_shipments")
    .select("category")
    .where("order_id", "=", orderId)
    .execute();
  const categories = await deriveShipmentCategories(executor, orderId);
  // This function is called while the PO Ready order is locked for vendor
  // handoff. Rows from older migrations or abandoned pre-handoff work are not
  // authoritative; replace them with the exact snapshot being sent now.
  if (existing.length > 0) {
    await executor.deleteFrom("order_shipments")
      .where("order_id", "=", orderId)
      .execute();
  }
  if (categories.length > 0) {
    await executor.insertInto("order_shipments")
      .values(categories.map((category) => ({ order_id: orderId, category })))
      .execute();
  }
  return categories;
}

export async function loadOrderShipmentState(
  executor: Executor,
  orderId: string,
): Promise<{ categories: ShipmentCategory[]; shipments: ShipmentValues[] }> {
  const rows = await executor.selectFrom("order_shipments")
    .select([
      "category",
      "local_delivery_number",
      "overseas_freight_number",
      "arrived_checked_at",
      "arrival_note",
      "legacy_local_delivery_number",
      "legacy_overseas_freight_number",
      "source",
      "updated_at",
    ])
    .where("order_id", "=", orderId)
    .execute();

  const categories = rows.length > 0
    ? SHIPMENT_CATEGORIES.filter((category) =>
        rows.some((row) => row.category === category))
    : await deriveShipmentCategories(executor, orderId);
  const rowByCategory = new Map(rows.map((row) => [row.category, row]));
  const shipments = categories.map((category): ShipmentValues => {
    const row = rowByCategory.get(category);
    return {
      category,
      localDeliveryNumber: row?.local_delivery_number ?? null,
      overseasFreightNumber: row?.overseas_freight_number ?? null,
      arrivedCheckedAt: row?.arrived_checked_at ?? null,
      arrivalNote: row?.arrival_note ?? null,
      legacyLocalDeliveryNumber: row?.legacy_local_delivery_number ?? null,
      legacyOverseasFreightNumber: row?.legacy_overseas_freight_number ?? null,
      source: row?.source ?? "derived",
      updatedAt: row?.updated_at ?? new Date(0),
    };
  });

  return { categories, shipments };
}
