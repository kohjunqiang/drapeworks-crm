"use server";

import "server-only";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth/require-role";
import { db } from "@/lib/db/kysely";
import { userMessage } from "@/lib/errors";
import { fabricSchema } from "@/lib/validation/fabric";

export async function upsertFabric(input: unknown) {
  const session = await requireRole(["admin"]);
  const parsed = fabricSchema.parse(input);

  if (parsed.isNew) {
    // Surface a friendly "code already exists" error rather than letting the
    // DB throw a unique-constraint string.
    const existing = await db
      .selectFrom("fabrics")
      .select("code")
      .where("code", "=", parsed.code)
      .executeTakeFirst();
    if (existing) {
      throw new Error(`Fabric ${parsed.code} already exists`);
    }

    try {
      await db
        .insertInto("fabrics")
        .values({
          code: parsed.code,
          name: parsed.name,
          type: parsed.type,
          supplier: parsed.supplier ?? null,
          color: parsed.color,
          notes: parsed.notes ?? null,
          created_by: session.user.id,
        })
        .execute();
    } catch (err) {
      // Race: another admin created the same code between our check and our
      // insert. Map the constraint violation to a friendly message.
      const msg = err instanceof Error ? err.message : String(err);
      if (/duplicate key|violates.*unique/i.test(msg)) {
        throw new Error(`Fabric ${parsed.code} already exists`);
      }
      throw new Error(userMessage(err, "Could not add fabric"));
    }
  } else {
    try {
      await db
        .updateTable("fabrics")
        .set({
          name: parsed.name,
          type: parsed.type,
          supplier: parsed.supplier ?? null,
          color: parsed.color,
          notes: parsed.notes ?? null,
        })
        .where("code", "=", parsed.code)
        .execute();
    } catch (err) {
      throw new Error(userMessage(err, "Could not save fabric"));
    }
  }

  revalidatePath("/fabrics");
}

export async function toggleFabricStatus(code: string) {
  await requireRole(["admin"]);
  if (typeof code !== "string" || code.length === 0) {
    throw new Error("Invalid fabric code");
  }

  const current = await db
    .selectFrom("fabrics")
    .select("status")
    .where("code", "=", code)
    .executeTakeFirst();

  if (!current) throw new Error("Fabric not found");

  const next = current.status === "Active" ? "Discontinued" : "Active";

  try {
    await db
      .updateTable("fabrics")
      .set({ status: next })
      .where("code", "=", code)
      .execute();
  } catch (err) {
    throw new Error(userMessage(err, "Could not update fabric status"));
  }

  revalidatePath("/fabrics");
}
