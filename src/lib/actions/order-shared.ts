import "server-only";

import { randomUUID } from "node:crypto";

// Write-path obligations shared by every order-creating/updating action,
// whatever the product line. Deliberately NOT a "use server" module — those may
// only export async functions, and some of these are plain mappers.
//
// Four of these fail SILENTLY if an action forgets them, which is why they live
// in one place rather than being reimplemented per product line:
//  - stampQuoteBaseline: skip it and price_calc_at_quote_cents stays null
//    forever, so the staleness/re-quote path is dead code for that order.
//  - the order_status_events seed: skip it and the status timeline starts empty.
//  - keep-list reconciliation: skip it and a line item the consultant deleted
//    keeps being quoted and installed.
//  - the photo storage sweep: skip it and removing a room leaks bucket objects.

import type { Kysely, Transaction } from "kysely";

import { db } from "@/lib/db/kysely";
import type { DB, ProductLine } from "@/lib/db/schema";
import { computeOrderQuote } from "@/lib/pricing/order-quote";
import { adminClient } from "@/lib/supabase/admin";

export const PHOTO_BUCKET = "room-photos";

type Trx = Transaction<DB> | Kysely<DB>;

// Capture the calculator's current output as the order's quote baseline. Called
// after an order's line items/pricing are persisted so staleness is measured
// from what the calc produced at save time — NOT from the (possibly manually
// overridden) quoted price. Null when nothing is priced yet.
//
// MUST run after the transaction commits, since computeOrderQuote reads through
// the base `db` and would not see uncommitted rows.
export async function stampQuoteBaseline(orderId: string): Promise<void> {
  const quote = await computeOrderQuote(orderId);
  await db
    .updateTable("orders")
    .set({
      price_calc_at_quote_cents: quote && !quote.pricingIssues?.length ? quote.discountedSaleSgdCents : null,
    })
    .where("id", "=", orderId)
    .execute();
}

// The order columns that come straight off the validated meta block, shared by
// create and update. Product line is NOT among them: it is set by whichever
// action ran (createOrder takes the 'curtain' column default, createMeshOrder
// writes 'mesh'), so no request can express it.
export type OrderMetaLike = {
  property_type?: "HDB" | "Condo" | "Landed" | "Commercial";
  development?: string;
  site_address?: string;
  unit_type?: string;
  move_in_date?: string;
  price_quoted_cents: number;
  deposit_cents: number;
  freight_mode: "air" | "sea";
  channel: "standard" | "carousell";
  extra_install_cents: number;
  discount_bps: number;
  promo_label?: string;
  general_notes?: string;
  is_draft: boolean;
};

export function orderMetaColumns(meta: OrderMetaLike) {
  return {
    property_type: meta.property_type ?? null,
    development: meta.development ?? null,
    site_address: meta.site_address?.trim() || null,
    unit_type: meta.unit_type ?? null,
    move_in_date: meta.move_in_date ? meta.move_in_date : null,
    price_quoted_cents: meta.price_quoted_cents,
    deposit_cents: meta.deposit_cents,
    freight_mode: meta.freight_mode,
    channel: meta.channel,
    extra_install_sgd_cents: meta.extra_install_cents,
    discount_bps: meta.discount_bps,
    promo_label: meta.promo_label ?? null,
    general_notes: meta.general_notes ?? null,
    is_draft: meta.is_draft,
  };
}

// display_id / seq_year / seq_num are populated by a database trigger; these
// placeholders are what the insert has to supply. There is no numbering helper
// to call.
export const SEQ_PLACEHOLDERS = {
  seq_year: 0,
  seq_num: 0,
  display_id: "",
} as const;

/**
 * Duplicate one template room's photos into a newly inserted room.
 *
 * Storage paths are copied, never shared: deleting either order must not break
 * the other order's photos. The source room is constrained to the same
 * customer and product line so a crafted payload cannot copy arbitrary files.
 */
export async function cloneTemplateRoomPhotos(
  trx: Transaction<DB>,
  input: {
    sourceRoomId: string;
    targetRoomId: string;
    targetOrderId: string;
    customerId: string;
    productLine: ProductLine;
    uploadedBy: string;
    copiedPaths: string[];
  },
): Promise<void> {
  const sourceRoom = await trx
    .selectFrom("rooms")
    .innerJoin("orders", "orders.id", "rooms.order_id")
    .select("rooms.id")
    .where("rooms.id", "=", input.sourceRoomId)
    .where("orders.customer_id", "=", input.customerId)
    .where("orders.product_line", "=", input.productLine)
    .executeTakeFirst();
  if (!sourceRoom) throw new Error("The template room is no longer available");

  const photos = await trx
    .selectFrom("room_photos")
    .select([
      "storage_path",
      "mime_type",
      "size_bytes",
      "original_name",
      "position",
    ])
    .where("room_id", "=", input.sourceRoomId)
    .orderBy("position", "asc")
    .orderBy("created_at", "asc")
    .execute();
  const storage = adminClient().storage.from(PHOTO_BUCKET);

  for (const photo of photos) {
    const extension = /\.[a-z0-9]+$/i.exec(photo.storage_path)?.[0] ?? "";
    const targetPath = `orders/${input.targetOrderId}/rooms/${input.targetRoomId}/${randomUUID()}${extension}`;
    const { error } = await storage.copy(photo.storage_path, targetPath);
    if (error) {
      console.error("template room-photo copy failed:", error.message);
      throw new Error("Could not copy the previous room photos");
    }
    input.copiedPaths.push(targetPath);
    await trx.insertInto("room_photos").values({
      room_id: input.targetRoomId,
      storage_path: targetPath,
      mime_type: photo.mime_type,
      size_bytes: photo.size_bytes,
      original_name: photo.original_name,
      uploaded_by: input.uploadedBy,
      position: photo.position,
    }).execute();
  }
}

// Every room_photo storage_path about to be cascade-deleted when rooms outside
// `keepRoomIds` are removed. Captured BEFORE the delete, swept AFTER the commit,
// so a rollback can't leave deleted files behind live rows.
export async function collectOrphanPhotoPaths(
  trx: Trx,
  orderId: string,
  keepRoomIds: string[],
): Promise<string[]> {
  let q = trx
    .selectFrom("room_photos")
    .innerJoin("rooms", "rooms.id", "room_photos.room_id")
    .select("room_photos.storage_path as storage_path")
    .where("rooms.order_id", "=", orderId);
  if (keepRoomIds.length > 0) {
    q = q.where("rooms.id", "not in", keepRoomIds);
  }
  return (await q.execute()).map((r) => r.storage_path);
}

/** Delete rooms of this order that aren't in the keep list. */
export async function deleteDroppedRooms(
  trx: Trx,
  orderId: string,
  keepRoomIds: string[],
): Promise<void> {
  let q = trx.deleteFrom("rooms").where("order_id", "=", orderId);
  if (keepRoomIds.length > 0) {
    q = q.where("id", "not in", keepRoomIds);
  }
  await q.execute();
}

// A failed sweep is logged, never thrown: the database is already consistent,
// and failing the user's save over an orphaned file would be worse.
export async function sweepPhotoStorage(
  paths: string[],
  context: string,
): Promise<void> {
  if (paths.length === 0) return;
  const { error } = await adminClient()
    .storage.from(PHOTO_BUCKET)
    .remove(paths);
  if (error) {
    console.error(
      `room-photo storage sweep failed during ${context}:`,
      error.message,
    );
  }
}
