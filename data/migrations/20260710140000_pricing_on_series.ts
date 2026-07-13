import { sql, type Kysely } from "kysely";

// Phase 9 revision — pricing lives on the SERIES, not each curtain type. A
// series (e.g. "signature") carries the chosen vendor + cost (RMB) + sale (SGD);
// every curtain type in it inherits that price. Also simplifies vendors to
// "unique name + system id" (drops the manual V001-style code).
//
// This moves the pricing columns added in 20260710130000 from curtain_types to
// curtain_series. Only test data existed on curtain_types, so the move is clean.

export async function up(db: Kysely<unknown>): Promise<void> {
  // ── vendors: name + system id (drop manual code) ───────────────────────
  await sql`drop index if exists public.vendors_code_unique`.execute(db);
  await db.schema.alterTable("vendors").dropColumn("code").execute();
  await sql`create unique index vendors_name_unique on public.vendors (lower(name))`.execute(
    db,
  );

  // ── curtain_series: add pricing (reuse the pricing_calc_method enum) ────
  await db.schema
    .alterTable("curtain_series")
    .addColumn("vendor_id", "uuid", (c) => c.references("vendors.id"))
    .addColumn("cost_rmb_cents", "integer")
    .addColumn("sale_sgd_cents", "integer")
    .addColumn("calc_method", sql`pricing_calc_method`, (c) =>
      c.notNull().defaultTo("by_width"),
    )
    .execute();
  await sql`
    alter table public.curtain_series
      add constraint curtain_series_cost_nonneg
        check (cost_rmb_cents is null or cost_rmb_cents >= 0),
      add constraint curtain_series_sale_nonneg
        check (sale_sgd_cents is null or sale_sgd_cents >= 0)
  `.execute(db);

  // ── curtain_types: drop the pricing columns (now on the series) ────────
  await sql`
    alter table public.curtain_types
      drop constraint if exists curtain_types_cost_nonneg,
      drop constraint if exists curtain_types_sale_nonneg
  `.execute(db);
  await db.schema.alterTable("curtain_types").dropColumn("calc_method").execute();
  await db.schema
    .alterTable("curtain_types")
    .dropColumn("sale_sgd_cents")
    .execute();
  await db.schema
    .alterTable("curtain_types")
    .dropColumn("cost_rmb_cents")
    .execute();
  await db.schema.alterTable("curtain_types").dropColumn("vendor_id").execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Restore curtain_types pricing columns.
  await db.schema
    .alterTable("curtain_types")
    .addColumn("vendor_id", "uuid", (c) => c.references("vendors.id"))
    .addColumn("cost_rmb_cents", "integer")
    .addColumn("sale_sgd_cents", "integer")
    .addColumn("calc_method", sql`pricing_calc_method`, (c) =>
      c.notNull().defaultTo("by_width"),
    )
    .execute();
  await sql`
    alter table public.curtain_types
      add constraint curtain_types_cost_nonneg
        check (cost_rmb_cents is null or cost_rmb_cents >= 0),
      add constraint curtain_types_sale_nonneg
        check (sale_sgd_cents is null or sale_sgd_cents >= 0)
  `.execute(db);

  // Remove curtain_series pricing.
  await sql`
    alter table public.curtain_series
      drop constraint if exists curtain_series_cost_nonneg,
      drop constraint if exists curtain_series_sale_nonneg
  `.execute(db);
  await db.schema
    .alterTable("curtain_series")
    .dropColumn("calc_method")
    .execute();
  await db.schema
    .alterTable("curtain_series")
    .dropColumn("sale_sgd_cents")
    .execute();
  await db.schema
    .alterTable("curtain_series")
    .dropColumn("cost_rmb_cents")
    .execute();
  await db.schema
    .alterTable("curtain_series")
    .dropColumn("vendor_id")
    .execute();

  // Restore vendors.code.
  await sql`drop index if exists public.vendors_name_unique`.execute(db);
  await db.schema
    .alterTable("vendors")
    .addColumn("code", "text", (c) => c.notNull().defaultTo(""))
    .execute();
  await sql`create unique index vendors_code_unique on public.vendors (lower(code))`.execute(
    db,
  );
}
