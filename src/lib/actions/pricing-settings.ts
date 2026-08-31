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

const PATH = "/admin/pricing-settings/shared";

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

  const money = (v: string | undefined) =>
    v && v !== "" ? dollarsToCents(v) : null;

  const values = {
    label: parsed.label,
    cost_rmb_cents: money(parsed.cost_rmb),
    sale_sgd_cents: money(parsed.sale_sgd),
    basis: parsed.basis,
    applies_to: parsed.applies_to,
    auto_rule: parsed.auto_rule,
    auto_width_over_cm: parsed.auto_width_over_cm ?? null,
  };

  try {
    if (parsed.id) {
      await db
        .updateTable("pricing_addons")
        .set(values)
        .where("id", "=", parsed.id)
        .execute();
    } else {
      // The key is derived from the label once and immutable thereafter: it is
      // how seeds and migrations reference a row by name, so it must not drift
      // when someone rewords the label.
      const key = parsed.label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
      if (!key) throw new Error("Give the add-on a name with letters in it");
      await db.insertInto("pricing_addons").values({ key, ...values }).execute();
    }
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
