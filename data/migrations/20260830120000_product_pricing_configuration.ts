import { sql, type Kysely } from "kysely";

// Product-specific selling-price configuration. Curtains and blinds use
// whole-home package rules; mesh keeps its existing, independent price book.
// Nullable package money means "not configured" rather than silently free.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create type public.blind_package_family as enum (
      'venetian_roman_non_200', 'roller', 'combi', 'roman_200'
    )
  `.execute(db);

  await db.schema
    .createTable("pricing_property_tiers")
    .addColumn("id", "uuid", (c) =>
      c.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("code", "text", (c) => c.notNull().unique())
    .addColumn("label", "text", (c) => c.notNull())
    .addColumn("room_set_count", "integer", (c) => c.notNull())
    .addColumn("position", "integer", (c) => c.notNull())
    .addColumn("is_active", "boolean", (c) => c.notNull().defaultTo(true))
    .addColumn("created_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .addColumn("updated_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await sql`
    alter table public.pricing_property_tiers
      add constraint pricing_property_tiers_room_sets_positive
      check (room_set_count > 0)
  `.execute(db);

  await db.schema
    .createTable("curtain_package_prices")
    .addColumn("property_tier_id", "uuid", (c) =>
      c.primaryKey().references("pricing_property_tiers.id").onDelete("restrict"),
    )
    .addColumn("essential_price_sgd_cents", "integer")
    .addColumn("pls_upgrade_sgd_cents", "integer")
    .addColumn("updated_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await sql`
    alter table public.curtain_package_prices
      add constraint curtain_package_prices_nonnegative check (
        (essential_price_sgd_cents is null or essential_price_sgd_cents >= 0)
        and (pls_upgrade_sgd_cents is null or pls_upgrade_sgd_cents >= 0)
      )
  `.execute(db);

  await db.schema
    .createTable("curtain_pricing_adjustments")
    .addColumn("singleton", "boolean", (c) =>
      c.primaryKey().defaultTo(true),
    )
    .addColumn("ultimate_from_essential_sgd_cents", "integer", (c) => c.notNull())
    .addColumn("ultimate_from_pls_sgd_cents", "integer", (c) => c.notNull())
    .addColumn("zen_default_sgd_cents", "integer", (c) => c.notNull())
    .addColumn("zen_4m_sgd_cents", "integer", (c) => c.notNull())
    .addColumn("zen_5m_sgd_cents", "integer", (c) => c.notNull())
    .addColumn("s_fold_3m_sgd_cents", "integer", (c) => c.notNull())
    .addColumn("s_fold_4m_sgd_cents", "integer", (c) => c.notNull())
    .addColumn("remove_day_sgd_cents", "integer", (c) => c.notNull())
    .addColumn("remove_essential_sgd_cents", "integer", (c) => c.notNull())
    .addColumn("remove_pls_sgd_cents", "integer", (c) => c.notNull())
    .addColumn("add_day_sgd_cents", "integer", (c) => c.notNull())
    .addColumn("add_essential_sgd_cents", "integer", (c) => c.notNull())
    .addColumn("add_pls_sgd_cents", "integer", (c) => c.notNull())
    .addColumn("blackout_per_m_sgd_cents", "integer", (c) => c.notNull())
    .addColumn("slim_single_per_m_sgd_cents", "integer", (c) => c.notNull())
    .addColumn("slim_double_per_m_sgd_cents", "integer", (c) => c.notNull())
    .addColumn("updated_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await sql`
    alter table public.curtain_pricing_adjustments
      add constraint curtain_pricing_adjustments_singleton check (singleton),
      add constraint curtain_pricing_adjustments_nonnegative check (
        ultimate_from_essential_sgd_cents >= 0
        and ultimate_from_pls_sgd_cents >= 0
        and zen_default_sgd_cents >= 0
        and zen_4m_sgd_cents >= 0
        and zen_5m_sgd_cents >= 0
        and s_fold_3m_sgd_cents >= 0
        and s_fold_4m_sgd_cents >= 0
        and remove_day_sgd_cents >= 0
        and remove_essential_sgd_cents >= 0
        and remove_pls_sgd_cents >= 0
        and add_day_sgd_cents >= 0
        and add_essential_sgd_cents >= 0
        and add_pls_sgd_cents >= 0
        and blackout_per_m_sgd_cents >= 0
        and slim_single_per_m_sgd_cents >= 0
        and slim_double_per_m_sgd_cents >= 0
      )
  `.execute(db);

  await db.schema
    .createTable("blind_package_prices")
    .addColumn("property_tier_id", "uuid", (c) =>
      c.notNull().references("pricing_property_tiers.id").onDelete("restrict"),
    )
    .addColumn("family", sql`public.blind_package_family`, (c) => c.notNull())
    .addColumn("price_sgd_cents", "integer", (c) => c.notNull())
    .addColumn("updated_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .addPrimaryKeyConstraint("blind_package_prices_pkey", [
      "property_tier_id",
      "family",
    ])
    .execute();

  await sql`
    alter table public.blind_package_prices
      add constraint blind_package_prices_nonnegative check (price_sgd_cents >= 0)
  `.execute(db);

  for (const table of [
    "pricing_property_tiers",
    "curtain_package_prices",
    "curtain_pricing_adjustments",
    "blind_package_prices",
  ]) {
    await sql`
      create trigger ${sql.raw(`${table}_set_updated_at`)}
        before update on ${sql.table(`public.${table}`)}
        for each row execute function public.set_updated_at()
    `.execute(db);
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("blind_package_prices").execute();
  await db.schema.dropTable("curtain_pricing_adjustments").execute();
  await db.schema.dropTable("curtain_package_prices").execute();
  await db.schema.dropTable("pricing_property_tiers").execute();
  await sql`drop type public.blind_package_family`.execute(db);
}
