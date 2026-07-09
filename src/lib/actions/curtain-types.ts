"use server";

import "server-only";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { Transaction } from "kysely";

import { requireRole } from "@/lib/auth/require-role";
import { nextSeriesIndex } from "@/lib/curtain-types/series";
import { db } from "@/lib/db/kysely";
import type { DB } from "@/lib/db/schema";
import { userMessage } from "@/lib/errors";
import {
  assertCurtainTypePhotoAllowed,
  buildCurtainTypePhotoPath,
  CURTAIN_TYPE_PHOTO_BUCKET,
} from "@/lib/storage/curtain-type-photo";
import { adminClient } from "@/lib/supabase/admin";
import { curtainTypeSchema } from "@/lib/validation/curtain-type";

const CATALOGUE_PATH = "/admin/digital-catalogue";

function revalidateCatalogue() {
  revalidatePath(CATALOGUE_PATH);
  // Active types feed the consultation form's pickers.
  revalidatePath("/orders/new");
}

// Next running index within a series: max(existing) + 1. The unique index on
// (series_id, series_index) is the backstop if two admins add to the same
// series concurrently.
async function assignSeriesIndex(
  trx: Transaction<DB>,
  seriesId: string,
): Promise<number> {
  const rows = await trx
    .selectFrom("curtain_types")
    .select("series_index")
    .where("series_id", "=", seriesId)
    .where("series_index", "is not", null)
    .execute();
  return nextSeriesIndex(rows.map((r) => r.series_index as number));
}

// Returns the row id so the dialog can upload a photo against a freshly
// created type (the photo path is keyed by curtain-type id).
export async function upsertCurtainType(input: unknown): Promise<{ id: string }> {
  const session = await requireRole(["admin"]);
  const parsed = curtainTypeSchema.parse(input);

  try {
    const id = await db.transaction().execute(async (trx) => {
      if (parsed.isNew) {
        const seriesIndex = await assignSeriesIndex(trx, parsed.series_id);
        const row = await trx
          .insertInto("curtain_types")
          .values({
            label: parsed.label,
            category: parsed.category,
            series_id: parsed.series_id,
            series_index: seriesIndex,
            page: parsed.page ?? null,
            photo_path: parsed.photo_path ?? null,
            photo_mime: parsed.photo_mime ?? null,
            created_by: session.user.id,
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        return row.id;
      }

      if (!parsed.id) throw new Error("Missing curtain type id");
      const current = await trx
        .selectFrom("curtain_types")
        .select(["series_id", "series_index"])
        .where("id", "=", parsed.id)
        .executeTakeFirst();
      if (!current) throw new Error("Curtain type not found");

      // Reassign the running index only when the series changes (keeps stable
      // references; the old sequence keeps its gap).
      const seriesIndex =
        current.series_id === parsed.series_id
          ? current.series_index
          : await assignSeriesIndex(trx, parsed.series_id);

      await trx
        .updateTable("curtain_types")
        .set({
          label: parsed.label,
          category: parsed.category,
          series_id: parsed.series_id,
          series_index: seriesIndex,
          page: parsed.page ?? null,
          photo_path: parsed.photo_path ?? null,
          photo_mime: parsed.photo_mime ?? null,
        })
        .where("id", "=", parsed.id)
        .execute();
      return parsed.id;
    });

    revalidateCatalogue();
    return { id };
  } catch (err) {
    if (err instanceof Error && /not found|Missing curtain/i.test(err.message)) {
      throw err;
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (/duplicate key|unique/i.test(msg) && /series_index/i.test(msg)) {
      throw new Error(
        "Another item was added to this series at the same time — please try again.",
      );
    }
    throw new Error(
      userMessage(err, parsed.isNew ? "Could not add curtain type" : "Could not save curtain type"),
    );
  }
}

export async function toggleCurtainTypeStatus(id: string) {
  await requireRole(["admin"]);
  if (typeof id !== "string" || id.length === 0) {
    throw new Error("Invalid curtain type id");
  }

  const current = await db
    .selectFrom("curtain_types")
    .select("status")
    .where("id", "=", id)
    .executeTakeFirst();

  if (!current) throw new Error("Curtain type not found");

  // Soft delete — no hard deletes.
  const next = current.status === "Active" ? "Archived" : "Active";

  try {
    await db
      .updateTable("curtain_types")
      .set({ status: next })
      .where("id", "=", id)
      .execute();
  } catch (err) {
    throw new Error(userMessage(err, "Could not update curtain type status"));
  }

  revalidateCatalogue();
}

const requestSchema = z.object({
  curtainTypeId: z.string().uuid(),
  mime: z.string(),
  sizeBytes: z.number().int().positive(),
});

export async function requestCurtainTypePhotoUpload(input: unknown) {
  await requireRole(["admin"]);
  const parsed = requestSchema.parse(input);
  assertCurtainTypePhotoAllowed(parsed.mime, parsed.sizeBytes);

  const path = buildCurtainTypePhotoPath(
    parsed.curtainTypeId,
    parsed.mime,
    randomUUID(),
  );

  const admin = adminClient();
  const { data, error } = await admin.storage
    .from(CURTAIN_TYPE_PHOTO_BUCKET)
    .createSignedUploadUrl(path);
  if (error || !data) {
    throw new Error(userMessage(error, "Could not start upload"));
  }

  // Client PUTs the bytes directly to signedUrl — never proxied through Next.
  return { path, token: data.token, signedUrl: data.signedUrl };
}

const confirmSchema = z.object({
  curtainTypeId: z.string().uuid(),
  path: z.string().min(1),
  mime: z.string(),
});

export async function confirmCurtainTypePhotoUpload(input: unknown) {
  await requireRole(["admin"]);
  const parsed = confirmSchema.parse(input);

  // The object must live under this curtain type's folder.
  const expectedPrefix = `curtain-types/${parsed.curtainTypeId}/`;
  if (!parsed.path.startsWith(expectedPrefix)) {
    throw new Error("Upload path does not match curtain type");
  }

  // Verify the object actually exists before recording it.
  const admin = adminClient();
  const dir = parsed.path.split("/").slice(0, -1).join("/");
  const file = parsed.path.split("/").pop()!;
  const { data: listed, error: listErr } = await admin.storage
    .from(CURTAIN_TYPE_PHOTO_BUCKET)
    .list(dir, { search: file });
  if (listErr) throw new Error(userMessage(listErr, "Could not verify upload"));
  if (!listed || listed.length === 0) throw new Error("Upload not found");

  // Single hero photo lives directly on the row — no separate metadata table.
  try {
    await db
      .updateTable("curtain_types")
      .set({ photo_path: parsed.path, photo_mime: parsed.mime })
      .where("id", "=", parsed.curtainTypeId)
      .execute();
  } catch (err) {
    throw new Error(userMessage(err, "Could not save photo"));
  }

  revalidateCatalogue();
  return { path: parsed.path };
}

const cleanupSchema = z.object({
  curtainTypeId: z.string().uuid(),
  path: z.string().min(1),
});

// Best-effort cleanup when a client PUT to the signed URL succeeds but
// confirm fails — stops the bucket accruing orphan objects. Re-checks the
// path prefix so the action can't be abused to delete arbitrary objects.
export async function cleanupOrphanCurtainTypePhoto(input: unknown) {
  await requireRole(["admin"]);
  const parsed = cleanupSchema.parse(input);

  const expectedPrefix = `curtain-types/${parsed.curtainTypeId}/`;
  if (!parsed.path.startsWith(expectedPrefix)) {
    throw new Error("Cleanup path does not match curtain type");
  }

  const admin = adminClient();
  const { error } = await admin.storage
    .from(CURTAIN_TYPE_PHOTO_BUCKET)
    .remove([parsed.path]);
  if (error) {
    console.error("orphan curtain-type photo cleanup failed:", error.message);
  }
}
