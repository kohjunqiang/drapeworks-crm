import "server-only";

import { db } from "@/lib/db/kysely";
import { centsToDisplay } from "@/lib/money";
import type { BlindPackageFamily } from "@/lib/db/schema";

export type PricingPropertyTierRow = {
  id: string;
  code: string;
  label: string;
  roomSetCount: number;
};

export type CurtainPackageRow = {
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

export async function loadCurtainPackages(): Promise<CurtainPackageRow[]> {
  const rows = await db
    .selectFrom("curtain_packages as package")
    .innerJoin(
      "pricing_property_tiers as tier",
      "tier.id",
      "package.property_tier_id",
    )
    .select([
      "package.id",
      "package.name",
      "package.property_tier_id",
      "package.package_type",
      "package.base_tier",
      "package.price_sgd_cents",
      "package.tier2_upgrade_sgd_cents",
      "package.room_tier2_upgrade_sgd_cents",
      "package.room_tier2_downgrade_sgd_cents",
      "package.is_active",
      "tier.label as property_tier_label",
      "tier.room_set_count",
      "tier.position",
    ])
    .orderBy("package.is_active", "desc")
    .orderBy("tier.position", "asc")
    .orderBy("package.name", "asc")
    .execute();
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    propertyTierId: row.property_tier_id,
    propertyTierLabel: row.property_tier_label,
    roomSetCount: row.room_set_count,
    packageType: row.package_type as "single" | "double",
    baseTier: "essential",
    priceSgd: centsToDisplay(row.price_sgd_cents),
    tier2UpgradeSgd: centsToDisplay(row.tier2_upgrade_sgd_cents),
    roomTier2UpgradeSgd: centsToDisplay(row.room_tier2_upgrade_sgd_cents),
    roomTier2DowngradeSgd: centsToDisplay(row.room_tier2_downgrade_sgd_cents),
    isActive: row.is_active,
  }));
}

export type CurtainAdjustmentSettings = {
  ultimate_from_essential_sgd: string;
  ultimate_from_pls_sgd: string;
  zen_default_sgd: string;
  zen_4m_sgd: string;
  zen_5m_sgd: string;
  s_fold_3m_sgd: string;
  s_fold_4m_sgd: string;
  s_fold_above_4m_sgd: string;
  remove_day_sgd: string;
  remove_essential_sgd: string;
  remove_pls_sgd: string;
  add_day_sgd: string;
  add_essential_sgd: string;
  add_pls_sgd: string;
  blackout_per_m_sgd: string;
  slim_single_per_m_sgd: string;
  slim_double_per_m_sgd: string;
};

export async function loadPricingPropertyTiers(): Promise<PricingPropertyTierRow[]> {
  const rows = await db
    .selectFrom("pricing_property_tiers")
    .select(["id", "code", "label", "room_set_count"])
    .where("is_active", "=", true)
    .orderBy("position", "asc")
    .execute();
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    label: row.label,
    roomSetCount: row.room_set_count,
  }));
}

export async function loadCurtainPackageSettings(): Promise<{
  adjustments: CurtainAdjustmentSettings | null;
}> {
  const adjustment = await db
    .selectFrom("curtain_pricing_adjustments")
    .selectAll()
    .where("singleton", "=", true)
    .executeTakeFirst();

  const display = (value: number | null | undefined) =>
    value == null ? "" : centsToDisplay(value);

  return {
    adjustments: adjustment
      ? {
          ultimate_from_essential_sgd: display(
            adjustment.ultimate_from_essential_sgd_cents,
          ),
          ultimate_from_pls_sgd: display(adjustment.ultimate_from_pls_sgd_cents),
          zen_default_sgd: display(adjustment.zen_default_sgd_cents),
          zen_4m_sgd: display(adjustment.zen_4m_sgd_cents),
          zen_5m_sgd: display(adjustment.zen_5m_sgd_cents),
          s_fold_3m_sgd: display(adjustment.s_fold_3m_sgd_cents),
          s_fold_4m_sgd: display(adjustment.s_fold_4m_sgd_cents),
          s_fold_above_4m_sgd: display(adjustment.s_fold_above_4m_sgd_cents),
          remove_day_sgd: display(adjustment.remove_day_sgd_cents),
          remove_essential_sgd: display(adjustment.remove_essential_sgd_cents),
          remove_pls_sgd: display(adjustment.remove_pls_sgd_cents),
          add_day_sgd: display(adjustment.add_day_sgd_cents),
          add_essential_sgd: display(adjustment.add_essential_sgd_cents),
          add_pls_sgd: display(adjustment.add_pls_sgd_cents),
          blackout_per_m_sgd: display(adjustment.blackout_per_m_sgd_cents),
          slim_single_per_m_sgd: display(
            adjustment.slim_single_per_m_sgd_cents,
          ),
          slim_double_per_m_sgd: display(
            adjustment.slim_double_per_m_sgd_cents,
          ),
        }
      : null,
  };
}

export type BlindPackageSettingsRow = PricingPropertyTierRow &
  Record<BlindPackageFamily, string>;

export async function loadBlindPackageSettings(): Promise<BlindPackageSettingsRow[]> {
  const [tiers, prices] = await Promise.all([
    loadPricingPropertyTiers(),
    db.selectFrom("blind_package_prices").selectAll().execute(),
  ]);
  const byTier = new Map<string, Map<BlindPackageFamily, string>>();
  for (const price of prices) {
    const family = byTier.get(price.property_tier_id) ?? new Map();
    family.set(
      price.family,
      price.price_sgd_cents == null ? "" : centsToDisplay(price.price_sgd_cents),
    );
    byTier.set(price.property_tier_id, family);
  }
  return tiers.map((tier) => ({
    ...tier,
    venetian_roman_non_200:
      byTier.get(tier.id)?.get("venetian_roman_non_200") ?? "",
    roller: byTier.get(tier.id)?.get("roller") ?? "",
    combi: byTier.get(tier.id)?.get("combi") ?? "",
    roman_200: byTier.get(tier.id)?.get("roman_200") ?? "",
  }));
}
