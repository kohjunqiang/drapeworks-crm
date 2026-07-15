"use server";

import "server-only";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth/require-role";
import { db } from "@/lib/db/kysely";
import { userMessage } from "@/lib/errors";
import { dollarsToCents } from "@/lib/money";
import {
  assumptionsSchema,
  assumptionsToStorage,
  pricingAddonSchema,
} from "@/lib/validation/pricing-settings";

const PATH = "/admin/pricing-settings";

export async function updatePricingAssumptions(input: unknown) {
  await requireRole(["admin"]);
  const parsed = assumptionsSchema.parse(input);
  const row = assumptionsToStorage(parsed);

  try {
    await db
      .updateTable("pricing_assumptions")
      .set(row)
      .where("singleton", "=", true)
      .execute();
  } catch (err) {
    throw new Error(userMessage(err, "Could not save assumptions"));
  }
  revalidatePath(PATH);
}

export async function upsertPricingAddon(input: unknown) {
  await requireRole(["admin"]);
  const parsed = pricingAddonSchema.parse(input);

  try {
    await db
      .updateTable("pricing_addons")
      .set({
        label: parsed.label,
        cost_rmb_cents:
          parsed.cost_rmb && parsed.cost_rmb !== ""
            ? dollarsToCents(parsed.cost_rmb)
            : null,
        sale_sgd_cents:
          parsed.sale_sgd && parsed.sale_sgd !== ""
            ? dollarsToCents(parsed.sale_sgd)
            : null,
        basis: parsed.basis,
      })
      .where("id", "=", parsed.id)
      .execute();
  } catch (err) {
    throw new Error(userMessage(err, "Could not save add-on"));
  }
  revalidatePath(PATH);
}

export async function togglePricingAddonActive(id: string) {
  await requireRole(["admin"]);
  if (typeof id !== "string" || id.length === 0) {
    throw new Error("Invalid add-on id");
  }

  const current = await db
    .selectFrom("pricing_addons")
    .select("is_active")
    .where("id", "=", id)
    .executeTakeFirst();
  if (!current) throw new Error("Add-on not found");

  try {
    await db
      .updateTable("pricing_addons")
      .set({ is_active: !current.is_active })
      .where("id", "=", id)
      .execute();
  } catch (err) {
    throw new Error(userMessage(err, "Could not update add-on"));
  }
  revalidatePath(PATH);
}
