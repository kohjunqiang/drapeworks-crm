"use server";

import "server-only";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth/require-role";
import { db } from "@/lib/db/kysely";
import { userMessage } from "@/lib/errors";
import { promotionSchema } from "@/lib/validation/promotion";

const PATH = "/admin/pricing-settings";

// Returns the created row on insert (so the client list can append it without
// a full reload); null on update.
export type UpsertedPromotion = {
  id: string;
  name: string;
  discountPct: string;
  is_active: boolean;
};

export async function upsertPromotion(
  input: unknown,
): Promise<UpsertedPromotion | null> {
  await requireRole(["admin"]);
  const parsed = promotionSchema.parse(input);
  const discount_bps = Math.round(parsed.discountPct * 100); // 15% → 1500

  try {
    if (parsed.isNew) {
      const row = await db
        .insertInto("promotions")
        .values({ name: parsed.name, discount_bps })
        .returning(["id", "name", "discount_bps", "is_active"])
        .executeTakeFirstOrThrow();
      revalidatePath(PATH);
      return {
        id: row.id,
        name: row.name,
        discountPct: (row.discount_bps / 100).toString(),
        is_active: row.is_active,
      };
    }
    if (!parsed.id) throw new Error("Missing promotion id");
    await db
      .updateTable("promotions")
      .set({ name: parsed.name, discount_bps })
      .where("id", "=", parsed.id)
      .execute();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/duplicate key|unique/i.test(msg)) {
      throw new Error(`Promotion "${parsed.name}" already exists`);
    }
    if (err instanceof Error && /Missing promotion id/.test(err.message)) throw err;
    throw new Error(userMessage(err, "Could not save promotion"));
  }
  revalidatePath(PATH);
  return null;
}

export async function togglePromotionActive(id: string) {
  await requireRole(["admin"]);
  if (typeof id !== "string" || id.length === 0) {
    throw new Error("Invalid promotion id");
  }

  const current = await db
    .selectFrom("promotions")
    .select("is_active")
    .where("id", "=", id)
    .executeTakeFirst();
  if (!current) throw new Error("Promotion not found");

  // Soft archive — no hard deletes. Archived tiers drop out of the consultant
  // picker; saved orders keep their denormalised discount_bps + promo_label.
  try {
    await db
      .updateTable("promotions")
      .set({ is_active: !current.is_active })
      .where("id", "=", id)
      .execute();
  } catch (err) {
    throw new Error(userMessage(err, "Could not update promotion"));
  }
  revalidatePath(PATH);
}
