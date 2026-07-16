"use server";

import "server-only";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth/require-role";
import { db } from "@/lib/db/kysely";
import { userMessage } from "@/lib/errors";
import { centsToDisplay, dollarsToCents } from "@/lib/money";
import { comboSchema } from "@/lib/validation/combo";

const PATH = "/admin/pricing-settings";

// Returns the created row on insert (so the client list can append it without
// a full reload); null on update.
export type UpsertedCombo = {
  id: string;
  name: string;
  day_series_id: string | null;
  night_series_id: string | null;
  price_sgd: string;
  is_active: boolean;
};

export async function upsertCombo(
  input: unknown,
): Promise<UpsertedCombo | null> {
  await requireRole(["admin"]);
  const parsed = comboSchema.parse(input);
  const values = {
    name: parsed.name,
    day_series_id: parsed.day_series_id ?? null,
    night_series_id: parsed.night_series_id ?? null,
    price_sgd_cents: dollarsToCents(parsed.price_sgd),
  };

  try {
    if (parsed.isNew) {
      const row = await db
        .insertInto("pricing_combos")
        .values(values)
        .returning([
          "id",
          "name",
          "day_series_id",
          "night_series_id",
          "price_sgd_cents",
          "is_active",
        ])
        .executeTakeFirstOrThrow();
      revalidatePath(PATH);
      return {
        id: row.id,
        name: row.name,
        day_series_id: row.day_series_id,
        night_series_id: row.night_series_id,
        price_sgd: centsToDisplay(row.price_sgd_cents),
        is_active: row.is_active,
      };
    }
    if (!parsed.id) throw new Error("Missing combo id");
    await db
      .updateTable("pricing_combos")
      .set(values)
      .where("id", "=", parsed.id)
      .execute();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/duplicate key|unique/i.test(msg)) {
      throw new Error(`Combo "${parsed.name}" already exists`);
    }
    if (err instanceof Error && /Missing combo id/.test(err.message)) throw err;
    throw new Error(userMessage(err, "Could not save combo"));
  }
  revalidatePath(PATH);
  return null;
}

export async function toggleComboActive(id: string) {
  await requireRole(["admin"]);
  if (typeof id !== "string" || id.length === 0) {
    throw new Error("Invalid combo id");
  }

  const current = await db
    .selectFrom("pricing_combos")
    .select("is_active")
    .where("id", "=", id)
    .executeTakeFirst();
  if (!current) throw new Error("Combo not found");

  // Soft archive — no hard deletes. Archived combos drop out of the window
  // picker; windows already referencing one keep the reference.
  try {
    await db
      .updateTable("pricing_combos")
      .set({ is_active: !current.is_active })
      .where("id", "=", id)
      .execute();
  } catch (err) {
    throw new Error(userMessage(err, "Could not update combo"));
  }
  revalidatePath(PATH);
}
