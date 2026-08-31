import { sql, type Kysely } from "kysely";

// The self-service curtain_packages table is the only package price source.
// Earlier property-tier rates and Day/Night header columns were transitional.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table public.curtain_package_prices
      rename to curtain_package_prices_legacy
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table public.curtain_package_prices_legacy
      rename to curtain_package_prices
  `.execute(db);
}
