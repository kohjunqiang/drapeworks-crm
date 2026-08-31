import { sql, type Kysely } from "kysely";

// Orders reference the offer for traceability and snapshot its commercial
// terms so later package edits cannot rewrite an accepted quote.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table public.orders
      add column curtain_package_id uuid references public.curtain_packages(id) on delete restrict,
      add column curtain_package_name text,
      add column curtain_package_type text,
      add column curtain_package_tier text,
      add column curtain_package_sale_sgd_cents integer,
      add constraint orders_curtain_package_type_check
        check (curtain_package_type is null or curtain_package_type in ('single', 'double')),
      add constraint orders_curtain_package_tier_check
        check (curtain_package_tier is null or curtain_package_tier in ('essential', 'tier2')),
      add constraint orders_curtain_package_sale_nonnegative
        check (curtain_package_sale_sgd_cents is null or curtain_package_sale_sgd_cents >= 0)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table public.orders
      drop constraint orders_curtain_package_type_check,
      drop constraint orders_curtain_package_tier_check,
      drop constraint orders_curtain_package_sale_nonnegative,
      drop column curtain_package_id,
      drop column curtain_package_name,
      drop column curtain_package_type,
      drop column curtain_package_tier,
      drop column curtain_package_sale_sgd_cents
  `.execute(db);
}
