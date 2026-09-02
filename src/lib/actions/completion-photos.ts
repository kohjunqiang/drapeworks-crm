"use server";

import "server-only";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireRole } from "@/lib/auth/require-role";
import { COMPLETION_PHOTO_BUCKET } from "@/lib/db/completion-photos";
import { db } from "@/lib/db/kysely";
import { userMessage } from "@/lib/errors";
import { adminClient } from "@/lib/supabase/admin";

const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);
const MAX_BYTES = 10 * 1024 * 1024;

function extForMime(mime: string): string {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

async function assertOrderExists(orderId: string): Promise<void> {
  const order = await db
    .selectFrom("orders")
    .select("id")
    .where("id", "=", orderId)
    .executeTakeFirst();
  if (!order) throw new Error("Order not found");
}

const requestSchema = z.object({
  orderId: z.string().uuid(),
  mime: z.string(),
  sizeBytes: z.number().int().positive(),
  originalName: z.string(),
});

export async function requestCompletionPhotoUpload(input: unknown) {
  await requireRole(["ops", "admin"]);
  const parsed = requestSchema.parse(input);
  if (!ALLOWED_MIME.has(parsed.mime)) throw new Error("Unsupported file type");
  if (parsed.sizeBytes > MAX_BYTES) {
    throw new Error("File too large (max 10MB)");
  }
  await assertOrderExists(parsed.orderId);

  const path = `orders/${parsed.orderId}/completion/${randomUUID()}.${extForMime(parsed.mime)}`;
  const { data, error } = await adminClient()
    .storage.from(COMPLETION_PHOTO_BUCKET)
    .createSignedUploadUrl(path);
  if (error || !data) {
    throw new Error(userMessage(error, "Could not start upload"));
  }
  return { path, signedUrl: data.signedUrl };
}

const confirmSchema = z.object({
  orderId: z.string().uuid(),
  path: z.string().min(1),
  mime: z.string(),
  sizeBytes: z.number().int().positive(),
  originalName: z.string(),
});

export async function confirmCompletionPhotoUpload(input: unknown) {
  const session = await requireRole(["ops", "admin"]);
  const parsed = confirmSchema.parse(input);
  if (!ALLOWED_MIME.has(parsed.mime)) throw new Error("Unsupported file type");
  if (parsed.sizeBytes > MAX_BYTES) {
    throw new Error("File too large (max 10MB)");
  }
  await assertOrderExists(parsed.orderId);
  const expectedPrefix = `orders/${parsed.orderId}/completion/`;
  if (!parsed.path.startsWith(expectedPrefix)) {
    throw new Error("Upload path does not match order");
  }

  const admin = adminClient();
  const dir = parsed.path.split("/").slice(0, -1).join("/");
  const file = parsed.path.split("/").pop()!;
  const { data: listed, error: listError } = await admin.storage
    .from(COMPLETION_PHOTO_BUCKET)
    .list(dir, { search: file });
  if (listError) {
    throw new Error(userMessage(listError, "Could not verify upload"));
  }
  if (!listed?.some((item) => item.name === file)) {
    throw new Error("Upload not found");
  }

  const photo = await db
    .insertInto("order_completion_photos")
    .values({
      order_id: parsed.orderId,
      storage_path: parsed.path,
      mime_type: parsed.mime,
      size_bytes: parsed.sizeBytes,
      original_name: parsed.originalName,
      uploaded_by: session.user.id,
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  revalidatePath(`/orders/${parsed.orderId}`);
  return { photoId: photo.id };
}

const cleanupSchema = z.object({
  orderId: z.string().uuid(),
  path: z.string().min(1),
});

export async function cleanupOrphanCompletionPhoto(input: unknown) {
  await requireRole(["ops", "admin"]);
  const parsed = cleanupSchema.parse(input);
  await assertOrderExists(parsed.orderId);
  if (!parsed.path.startsWith(`orders/${parsed.orderId}/completion/`)) {
    throw new Error("Cleanup path does not match order");
  }
  const { error } = await adminClient()
    .storage.from(COMPLETION_PHOTO_BUCKET)
    .remove([parsed.path]);
  if (error) console.error("completion photo orphan cleanup failed:", error.message);
}

export async function deleteCompletionPhoto(photoId: string): Promise<void> {
  await requireRole(["ops", "admin"]);
  if (typeof photoId !== "string" || photoId.length === 0) {
    throw new Error("Invalid photo id");
  }
  const photo = await db
    .selectFrom("order_completion_photos")
    .select(["id", "order_id", "storage_path"])
    .where("id", "=", photoId)
    .executeTakeFirst();
  if (!photo) throw new Error("Photo not found");

  await db.deleteFrom("order_completion_photos").where("id", "=", photo.id).execute();
  const { error } = await adminClient()
    .storage.from(COMPLETION_PHOTO_BUCKET)
    .remove([photo.storage_path]);
  if (error) console.error("completion photo storage remove failed:", error.message);
  revalidatePath(`/orders/${photo.order_id}`);
}
