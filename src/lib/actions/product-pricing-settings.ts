"use server";

import "server-only";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth/require-role";
import { db } from "@/lib/db/kysely";
import { userMessage } from "@/lib/errors";
import { dollarsToCents } from "@/lib/money";
import {
  blindPricingSchema,
  curtainPackageSchema,
  curtainPricingSchema,
} from "@/lib/validation/product-pricing";

const ROOT = "/admin/pricing-settings";

export type SavedCurtainPackage = {
  id: string;
  name: string;
  propertyTierId: string;
  propertyTierLabel: string;
  roomSetCount: number;
  packageType: "single" | "double";
  baseTier: "essential";
  priceSgd: string;
  tier2UpgradeSgd: string;
  roomTier2UpgradeSgd: string;
  roomTier2DowngradeSgd: string;
  isActive: boolean;
};

export async function upsertCurtainPackage(
  input: unknown,
): Promise<SavedCurtainPackage> {
  await requireRole(["admin"]);
  const parsed = curtainPackageSchema.parse(input);
  const tier = await db
    .selectFrom("pricing_property_tiers")
    .select(["id", "label", "room_set_count", "is_active"])
    .where("id", "=", parsed.property_tier_id)
    .executeTakeFirst();
  if (!tier || !tier.is_active) throw new Error("Select an active property tier");

  const values = {
    name: parsed.name,
    property_tier_id: parsed.property_tier_id,
    package_type: parsed.package_type,
    base_tier: parsed.base_tier,
    price_sgd_cents: dollarsToCents(parsed.price_sgd),
    room_tier2_upgrade_sgd_cents: parsed.room_tier2_upgrade_sgd == null ? null : dollarsToCents(parsed.room_tier2_upgrade_sgd),
    room_tier2_downgrade_sgd_cents: parsed.room_tier2_downgrade_sgd == null ? null : dollarsToCents(parsed.room_tier2_downgrade_sgd),
    tier2_upgrade_sgd_cents:
      parsed.tier2_upgrade_sgd == null
        ? null
        : dollarsToCents(parsed.tier2_upgrade_sgd),
  } as const;

  try {
    const row = parsed.isNew
      ? await db
          .insertInto("curtain_packages")
          .values(values)
          .returning(["id", "name", "package_type", "base_tier", "price_sgd_cents", "tier2_upgrade_sgd_cents", "is_active"])
          .executeTakeFirstOrThrow()
      : await db
          .updateTable("curtain_packages")
          .set(values)
          .where("id", "=", parsed.id ?? "")
          .returning(["id", "name", "package_type", "base_tier", "price_sgd_cents", "tier2_upgrade_sgd_cents", "is_active"])
          .executeTakeFirstOrThrow();
    revalidatePath(`${ROOT}/curtains`);
    return {
      id: row.id,
      name: row.name,
      propertyTierId: tier.id,
      propertyTierLabel: tier.label,
      roomSetCount: tier.room_set_count,
      packageType: row.package_type as "single" | "double",
      baseTier: "essential",
      priceSgd: (row.price_sgd_cents / 100).toFixed(2),
      tier2UpgradeSgd:
        row.tier2_upgrade_sgd_cents == null
          ? ""
          : (row.tier2_upgrade_sgd_cents / 100).toFixed(2),
      isActive: row.is_active,
      roomTier2UpgradeSgd: parsed.room_tier2_upgrade_sgd == null ? "" : (values.room_tier2_upgrade_sgd_cents! / 100).toFixed(2),
      roomTier2DowngradeSgd: parsed.room_tier2_downgrade_sgd == null ? "" : (values.room_tier2_downgrade_sgd_cents! / 100).toFixed(2),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/duplicate key|unique/i.test(message)) {
      throw new Error(`A curtain package named “${parsed.name}” already exists`);
    }
    throw new Error(userMessage(error, "Could not save curtain package"));
  }
}

export async function toggleCurtainPackageActive(id: string): Promise<void> {
  await requireRole(["admin"]);
  if (typeof id !== "string" || id.length === 0) {
    throw new Error("Invalid curtain package id");
  }
  const current = await db
    .selectFrom("curtain_packages")
    .select("is_active")
    .where("id", "=", id)
    .executeTakeFirst();
  if (!current) throw new Error("Curtain package not found");
  await db
    .updateTable("curtain_packages")
    .set({ is_active: !current.is_active })
    .where("id", "=", id)
    .execute();
  revalidatePath(`${ROOT}/curtains`);
}

export async function updateCurtainPricing(input: unknown): Promise<void> {
  await requireRole(["admin"]);
  const parsed = curtainPricingSchema.parse(input);
  const cents = (value: string) => dollarsToCents(value);

  try {
    await db.transaction().execute(async (trx) => {
      const a = parsed.adjustments;
      await trx
        .updateTable("curtain_pricing_adjustments")
        .set({
          ultimate_from_essential_sgd_cents: cents(
            a.ultimate_from_essential_sgd,
          ),
          ultimate_from_pls_sgd_cents: cents(a.ultimate_from_pls_sgd),
          zen_default_sgd_cents: cents(a.zen_default_sgd),
          zen_4m_sgd_cents: cents(a.zen_4m_sgd),
          zen_5m_sgd_cents: cents(a.zen_5m_sgd),
          s_fold_3m_sgd_cents: cents(a.s_fold_3m_sgd),
          s_fold_4m_sgd_cents: cents(a.s_fold_4m_sgd),
          s_fold_above_4m_sgd_cents: a.s_fold_above_4m_sgd == null ? null : cents(a.s_fold_above_4m_sgd),
          remove_day_sgd_cents: cents(a.remove_day_sgd),
          remove_essential_sgd_cents: cents(a.remove_essential_sgd),
          remove_pls_sgd_cents: cents(a.remove_pls_sgd),
          add_day_sgd_cents: cents(a.add_day_sgd),
          add_essential_sgd_cents: cents(a.add_essential_sgd),
          add_pls_sgd_cents: cents(a.add_pls_sgd),
          blackout_per_m_sgd_cents: cents(a.blackout_per_m_sgd),
          slim_single_per_m_sgd_cents: cents(a.slim_single_per_m_sgd),
          slim_double_per_m_sgd_cents: cents(a.slim_double_per_m_sgd),
        })
        .where("singleton", "=", true)
        .execute();
    });
  } catch (error) {
    throw new Error(userMessage(error, "Could not save curtain pricing"));
  }
  revalidatePath(`${ROOT}/curtains`);
}

export async function updateBlindPricing(input: unknown): Promise<void> {
  await requireRole(["admin"]);
  const parsed = blindPricingSchema.parse(input);
  try {
    await db.transaction().execute(async (trx) => {
      for (const row of parsed.prices) {
        const priceSgdCents =
          row.price_sgd == null ? null : dollarsToCents(row.price_sgd);
        await trx
          .insertInto("blind_package_prices")
          .values({
            property_tier_id: row.property_tier_id,
            family: row.family,
            price_sgd_cents: priceSgdCents,
          })
          .onConflict((conflict) =>
            conflict.columns(["property_tier_id", "family"]).doUpdateSet({
              price_sgd_cents: priceSgdCents,
            }),
          )
          .execute();
      }
    });
  } catch (error) {
    throw new Error(userMessage(error, "Could not save blind pricing"));
  }
  revalidatePath(`${ROOT}/blinds`);
}
