"use server";

import "server-only";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth/require-role";
import { db } from "@/lib/db/kysely";
import { userMessage } from "@/lib/errors";
import { curtainSeriesSchema } from "@/lib/validation/curtain-series";

function revalidateCatalogue() {
  revalidatePath("/admin/digital-catalogue");
  revalidatePath("/orders/new");
}

export async function upsertCurtainSeries(input: unknown) {
  const session = await requireRole(["admin"]);
  const parsed = curtainSeriesSchema.parse(input);

  try {
    if (parsed.isNew) {
      await db
        .insertInto("curtain_series")
        .values({ name: parsed.name, created_by: session.user.id })
        .execute();
    } else {
      if (!parsed.id) throw new Error("Missing series id");
      await db
        .updateTable("curtain_series")
        .set({ name: parsed.name })
        .where("id", "=", parsed.id)
        .execute();
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/duplicate key|unique/i.test(msg)) {
      throw new Error(`Series "${parsed.name}" already exists`);
    }
    if (err instanceof Error && /Missing series id/.test(err.message)) throw err;
    throw new Error(userMessage(err, "Could not save series"));
  }

  revalidateCatalogue();
}

export async function toggleCurtainSeriesActive(id: string) {
  await requireRole(["admin"]);
  if (typeof id !== "string" || id.length === 0) {
    throw new Error("Invalid series id");
  }

  const current = await db
    .selectFrom("curtain_series")
    .select("is_active")
    .where("id", "=", id)
    .executeTakeFirst();
  if (!current) throw new Error("Series not found");

  // Soft archive — no hard deletes. Archived series drop out of the assignment
  // dropdown; existing curtain types keep their reference.
  try {
    await db
      .updateTable("curtain_series")
      .set({ is_active: !current.is_active })
      .where("id", "=", id)
      .execute();
  } catch (err) {
    throw new Error(userMessage(err, "Could not update series"));
  }

  revalidateCatalogue();
}
