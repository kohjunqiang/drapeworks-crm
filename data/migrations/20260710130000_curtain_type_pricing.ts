import { sql, type Kysely } from "kysely";

// Phase 9 (pricing foundation), slice 2 — attach the chosen vendor + cost (RMB)
// + curated sale price (SGD) + calc method to each curtain type. 1:1 vendor per
// curtain. Additive/nullable so existing rows stay valid. Money is integer
// cents (RMB cost and SGD sale alike), per the project money rule.

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`create type pricing_calc_method as enum ('by_width', 'by_sqm')`.execute(
    db,
  );

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
}

export async function down(db: Kysely<unknown>): Promise<void> {
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
  await sql`drop type pricing_calc_method`.execute(db);
}
