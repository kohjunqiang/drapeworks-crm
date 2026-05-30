"use server";

import "server-only";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireRole } from "@/lib/auth/require-role";
import type { SessionData } from "@/lib/auth/get-session";
import { db } from "@/lib/db/kysely";
import { userMessage } from "@/lib/errors";
import { adminClient } from "@/lib/supabase/admin";

const BUCKET = "room-photos";
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);
const MAX_BYTES = 10 * 1024 * 1024;

async function assertCanWriteRoom(
  session: SessionData,
  roomId: string,
): Promise<string> {
  const row = await db
    .selectFrom("rooms")
    .innerJoin("orders", "orders.id", "rooms.order_id")
    .select(["rooms.order_id as order_id", "orders.consultant_id as consultant_id"])
    .where("rooms.id", "=", roomId)
    .executeTakeFirst();
  if (!row) throw new Error("Room not found");

  const isOwner = row.consultant_id === session.user.id;
  const isAdmin = session.profile.role === "admin";
  if (!isOwner && !isAdmin) throw new Error("Forbidden");
  return row.order_id;
}

function extForMime(mime: string): string {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

const requestSchema = z.object({
  roomId: z.string().uuid(),
  mime: z.string(),
  sizeBytes: z.number().int().positive(),
  originalName: z.string(),
});

export async function requestRoomPhotoUpload(input: unknown) {
  const session = await requireRole(["consultant", "admin"]);
  const parsed = requestSchema.parse(input);
  if (!ALLOWED_MIME.has(parsed.mime)) {
    throw new Error("Unsupported file type");
  }
  if (parsed.sizeBytes > MAX_BYTES) {
    throw new Error("File too large (max 10MB)");
  }

  const orderId = await assertCanWriteRoom(session, parsed.roomId);
  const path = `orders/${orderId}/rooms/${parsed.roomId}/${randomUUID()}.${extForMime(parsed.mime)}`;

  const admin = adminClient();
  const { data, error } = await admin.storage
    .from(BUCKET)
    .createSignedUploadUrl(path);
  if (error || !data) {
    throw new Error(userMessage(error, "Could not start upload"));
  }

  return { path, token: data.token, signedUrl: data.signedUrl };
}

const confirmSchema = z.object({
  roomId: z.string().uuid(),
  path: z.string().min(1),
  mime: z.string(),
  sizeBytes: z.number().int().positive(),
  originalName: z.string(),
});

export async function confirmRoomPhotoUpload(input: unknown) {
  const session = await requireRole(["consultant", "admin"]);
  const parsed = confirmSchema.parse(input);
  const orderId = await assertCanWriteRoom(session, parsed.roomId);

  // Sanity check: path must live under this room's folder.
  const expectedPrefix = `orders/${orderId}/rooms/${parsed.roomId}/`;
  if (!parsed.path.startsWith(expectedPrefix)) {
    throw new Error("Upload path does not match room");
  }

  // Verify the object actually exists.
  const admin = adminClient();
  const dir = parsed.path.split("/").slice(0, -1).join("/");
  const file = parsed.path.split("/").pop()!;
  const { data: listed, error: listErr } = await admin.storage
    .from(BUCKET)
    .list(dir, { search: file });
  if (listErr) throw new Error(userMessage(listErr, "Could not verify upload"));
  if (!listed || listed.length === 0) throw new Error("Upload not found");

  const inserted = await db
    .insertInto("room_photos")
    .values({
      room_id: parsed.roomId,
      storage_path: parsed.path,
      mime_type: parsed.mime,
      size_bytes: parsed.sizeBytes,
      original_name: parsed.originalName,
      uploaded_by: session.user.id,
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  revalidatePath(`/orders/${orderId}`);
  revalidatePath(`/orders/${orderId}/edit`);
  return { photoId: inserted.id };
}

export async function deleteRoomPhoto(photoId: string) {
  const session = await requireRole(["consultant", "admin"]);
  if (typeof photoId !== "string" || photoId.length === 0) {
    throw new Error("Invalid photo id");
  }

  const photo = await db
    .selectFrom("room_photos")
    .innerJoin("rooms", "rooms.id", "room_photos.room_id")
    .innerJoin("orders", "orders.id", "rooms.order_id")
    .select([
      "room_photos.id as id",
      "room_photos.storage_path as storage_path",
      "rooms.order_id as order_id",
      "orders.consultant_id as consultant_id",
    ])
    .where("room_photos.id", "=", photoId)
    .executeTakeFirst();

  if (!photo) throw new Error("Photo not found");

  const isOwner = photo.consultant_id === session.user.id;
  const isAdmin = session.profile.role === "admin";
  if (!isOwner && !isAdmin) throw new Error("Forbidden");

  // DB first: if the storage remove fails afterwards we leak a bucket
  // object but the page won't surface a broken signed URL. The reverse
  // order would leave a phantom row pointing at a deleted file.
  await db.deleteFrom("room_photos").where("id", "=", photoId).execute();

  const admin = adminClient();
  const { error: rmErr } = await admin.storage.from(BUCKET).remove([
    photo.storage_path,
  ]);
  if (rmErr) {
    // Log it but don't surface to the user; the row is already gone.
    console.error("storage remove failed after DB delete:", rmErr.message);
  }

  revalidatePath(`/orders/${photo.order_id}`);
  revalidatePath(`/orders/${photo.order_id}/edit`);
}

const cleanupSchema = z.object({
  roomId: z.string().uuid(),
  path: z.string().min(1),
});

// Best-effort cleanup when a client-side PUT to a signed upload URL succeeds
// but confirmRoomPhotoUpload fails. Without this, the bucket accrues orphan
// objects. We re-verify ownership of the room so the action can't be abused
// to delete arbitrary paths.
export async function cleanupOrphanUpload(input: unknown) {
  const session = await requireRole(["consultant", "admin"]);
  const parsed = cleanupSchema.parse(input);
  const orderId = await assertCanWriteRoom(session, parsed.roomId);

  const expectedPrefix = `orders/${orderId}/rooms/${parsed.roomId}/`;
  if (!parsed.path.startsWith(expectedPrefix)) {
    throw new Error("Cleanup path does not match room");
  }

  const admin = adminClient();
  const { error } = await admin.storage.from(BUCKET).remove([parsed.path]);
  if (error) {
    console.error("orphan cleanup failed:", error.message);
  }
}
