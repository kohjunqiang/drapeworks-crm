"use server";

import "server-only";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth/require-role";
import { db } from "@/lib/db/kysely";
import { fabricSchema } from "@/lib/validation/fabric";

export async function upsertFabric(input: unknown) {
  const session = await requireRole(["admin"]);
  const parsed = fabricSchema.parse(input);

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
    .onConflict((oc) =>
      oc.column("code").doUpdateSet({
        name: parsed.name,
        type: parsed.type,
        supplier: parsed.supplier ?? null,
        color: parsed.color,
        notes: parsed.notes ?? null,
      }),
    )
    .execute();

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

  await db
    .updateTable("fabrics")
    .set({ status: next })
    .where("code", "=", code)
    .execute();

  revalidatePath("/fabrics");
}
