import { sql, type Kysely } from "kysely";

// Existing RLS and admin-only pricing write policies cover the new columns.
// NULL is deliberately unconfigured; no invented charge/credit is seeded.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table public.curtain_pricing_adjustments
    add column s_fold_above_4m_sgd_cents integer check (s_fold_above_4m_sgd_cents >= 0)`.execute(db);
  await sql`alter table public.curtain_packages
    add column room_tier2_upgrade_sgd_cents integer check (room_tier2_upgrade_sgd_cents >= 0),
    add column room_tier2_downgrade_sgd_cents integer check (room_tier2_downgrade_sgd_cents >= 0)`.execute(db);
  await sql`alter table public.orders add column curtain_package_rules jsonb
    check (curtain_package_rules is null or jsonb_typeof(curtain_package_rules) = 'object')`.execute(db);
}
export async function down(): Promise<void> {
  throw new Error("Restore a reviewed backup to roll back pricing snapshots; do not discard sold-order rates");
}
