import { sql, type Kysely } from "kysely";

// Whole-package tier pricing belongs to the sellable package, not merely to a
// property tier: Single and Double offers at the same property size can have
// different transitions.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table public.curtain_packages
      add column tier2_upgrade_sgd_cents integer,
      add constraint curtain_packages_tier2_upgrade_nonnegative
        check (tier2_upgrade_sgd_cents is null or tier2_upgrade_sgd_cents >= 0)
  `.execute(db);
  await sql`
    update public.curtain_packages package
      set tier2_upgrade_sgd_cents = price.pls_upgrade_sgd_cents
      from public.curtain_package_prices price
      where price.property_tier_id = package.property_tier_id
        and package.tier2_upgrade_sgd_cents is null
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table public.curtain_packages
      drop constraint curtain_packages_tier2_upgrade_nonnegative,
      drop column tier2_upgrade_sgd_cents
  `.execute(db);
}
