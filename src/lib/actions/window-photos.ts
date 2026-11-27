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

// Per-window detail photos — the same signed-upload, private-bucket,
// owner-or-admin contract as room_photos, one level down.
const BUCKET = "window-photos";
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);
const MAX_BYTES = 10 * 1024 * 1024;

async function assertCanWriteWindow(
  session: SessionData,
  windowId: string,
): Promise<string> {
  const row = await db
    .selectFrom("windows")
    .innerJoin("rooms", "rooms.id", "windows.room_id")
    .innerJoin("orders", "orders.id", "rooms.order_id")
    .select([
      "rooms.order_id as order_id",
      "orders.consultant_id as consultant_id",
    ])
    .where("windows.id", "=", windowId)
    .executeTakeFirst();
  if (!row) throw new Error("Window not found");

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
  windowId: z.string().uuid(),
  mime: z.string(),
  sizeBytes: z.number().int().positive(),
  originalName: z.string(),
});

export async function requestWindowPhotoUpload(input: unknown) {
  const session = await requireRole(["consultant", "admin"]);
  const parsed = requestSchema.parse(input);
  if (!ALLOWED_MIME.has(parsed.mime)) {
    throw new Error("Unsupported file type");
  }
  if (parsed.sizeBytes > MAX_BYTES) {
    throw new Error("File too large (max 10MB)");
  }

  const orderId = await assertCanWriteWindow(session, parsed.windowId);
  const path = `orders/${orderId}/windows/${parsed.windowId}/${randomUUID()}.${extForMime(parsed.mime)}`;

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
  windowId: z.string().uuid(),
  path: z.string().min(1),
  mime: z.string(),
  sizeBytes: z.number().int().positive(),
  originalName: z.string(),
});

export async function confirmWindowPhotoUpload(input: unknown) {
  const session = await requireRole(["consultant", "admin"]);
  const parsed = confirmSchema.parse(input);
  if (!ALLOWED_MIME.has(parsed.mime)) {
    throw new Error("Unsupported file type");
  }
  if (parsed.sizeBytes > MAX_BYTES) {
    throw new Error("File too large (max 10MB)");
  }
  const orderId = await assertCanWriteWindow(session, parsed.windowId);

  // Sanity check: path must live under this window's folder, and the
  // extension must agree with the declared type — a mismatched payload
  // never signed through requestWindowPhotoUpload.
  const expectedPrefix = `orders/${orderId}/windows/${parsed.windowId}/`;
  if (
    !parsed.path.startsWith(expectedPrefix) ||
    !parsed.path.endsWith(`.${extForMime(parsed.mime)}`)
  ) {
    throw new Error("Upload path does not match window");
  }

  // A confirmed row already means the earlier response was lost mid-retry —
  // return it instead of duplicating the photo.
  const existing = await db
    .selectFrom("window_photos")
    .select("id")
    .where("storage_path", "=", parsed.path)
    .executeTakeFirst();
  if (existing) return { photoId: existing.id };

  // Verify the object actually exists — list() searches fuzzily, so require
  // an exact filename match and check the stored metadata agrees.
  const admin = adminClient();
  const dir = parsed.path.split("/").slice(0, -1).join("/");
  const file = parsed.path.split("/").pop()!;
  const { data: listed, error: listErr } = await admin.storage
    .from(BUCKET)
    .list(dir, { search: file });
  if (listErr) throw new Error(userMessage(listErr, "Could not verify upload"));
  const object = listed?.find((item) => item.name === file);
  if (!object) throw new Error("Upload not found");
  const meta = object.metadata as
    | { size?: number; mimetype?: string }
    | null
    | undefined;
  if (meta?.size != null && meta.size !== parsed.sizeBytes) {
    throw new Error("Uploaded file does not match the requested size");
  }
  if (meta?.mimetype && meta.mimetype !== parsed.mime) {
    throw new Error("Uploaded file does not match the requested type");
  }

  const inserted = await db
    .insertInto("window_photos")
    .values({
      window_id: parsed.windowId,
      storage_path: parsed.path,
      mime_type: parsed.mime,
      size_bytes: parsed.sizeBytes,
      original_name: parsed.originalName,
      uploaded_by: session.user.id,
    })
    .onConflict((conflict) => conflict.column("storage_path").doNothing())
    .returning("id")
    .executeTakeFirst();

  // Lost the race with a duplicate confirm — the existing row wins.
  const photoId =
    inserted?.id ??
    (
      await db
        .selectFrom("window_photos")
        .select("id")
        .where("storage_path", "=", parsed.path)
        .executeTakeFirstOrThrow()
    ).id;

  revalidatePath(`/orders/${orderId}`);
  revalidatePath(`/orders/${orderId}/edit`);
  return { photoId };
}

export async function deleteWindowPhoto(photoId: string) {
  const session = await requireRole(["consultant", "admin"]);
  if (typeof photoId !== "string" || photoId.length === 0) {
    throw new Error("Invalid photo id");
  }

  const photo = await db
    .selectFrom("window_photos")
    .innerJoin("windows", "windows.id", "window_photos.window_id")
    .innerJoin("rooms", "rooms.id", "windows.room_id")
    .innerJoin("orders", "orders.id", "rooms.order_id")
    .select([
      "window_photos.id as id",
      "window_photos.storage_path as storage_path",
      "rooms.order_id as order_id",
      "orders.consultant_id as consultant_id",
    ])
    .where("window_photos.id", "=", photoId)
    .executeTakeFirst();

  if (!photo) throw new Error("Photo not found");

  const isOwner = photo.consultant_id === session.user.id;
  const isAdmin = session.profile.role === "admin";
  if (!isOwner && !isAdmin) throw new Error("Forbidden");

  // DB first: if the storage remove fails afterwards we leak a bucket
  // object but the page won't surface a broken signed URL. The reverse
  // order would leave a phantom row pointing at a deleted file.
  await db.deleteFrom("window_photos").where("id", "=", photoId).execute();

  const admin = adminClient();
  const { error: rmErr } = await admin.storage.from(BUCKET).remove([
    photo.storage_path,
  ]);
  if (rmErr) {
    console.error("storage remove failed after DB delete:", rmErr.message);
  }

  revalidatePath(`/orders/${photo.order_id}`);
  revalidatePath(`/orders/${photo.order_id}/edit`);
}

const cleanupSchema = z.object({
  windowId: z.string().uuid(),
  path: z.string().min(1),
});

// Best-effort cleanup when a client-side PUT to a signed upload URL succeeds
// but confirmWindowPhotoUpload fails — mirrors cleanupOrphanUpload.
export async function cleanupOrphanWindowUpload(input: unknown) {
  const session = await requireRole(["consultant", "admin"]);
  const parsed = cleanupSchema.parse(input);
  const orderId = await assertCanWriteWindow(session, parsed.windowId);

  const expectedPrefix = `orders/${orderId}/windows/${parsed.windowId}/`;
  if (!parsed.path.startsWith(expectedPrefix)) {
    throw new Error("Cleanup path does not match window");
  }

  // A confirm that committed after the client gave up owns this object now —
  // removing it would orphan a live photo row.
  const referenced = await db
    .selectFrom("window_photos")
    .select("id")
    .where("storage_path", "=", parsed.path)
    .executeTakeFirst();
  if (referenced) {
    throw new Error("That photo is already saved to the order");
  }

  const admin = adminClient();
  const { error } = await admin.storage.from(BUCKET).remove([parsed.path]);
  if (error) {
    console.error("orphan cleanup failed:", error.message);
  }
}
