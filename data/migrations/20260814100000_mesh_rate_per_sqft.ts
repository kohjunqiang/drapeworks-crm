import { sql, type Kysely } from "kysely";

// Phase 11 correction — mesh prices per SQUARE FOOT, not flat per panel.
//
// The original design (20260806100000) priced a panel by looking up a flat
// amount in a category × size-band grid, so every panel inside a band cost the
// same. The real commercial model is a per-ft² rate held by the category:
//
//   sale = panel area in ft² × the category's sale rate
//
// which makes size bands and the price grid redundant — area now scales the
// price continuously instead of bucketing it. Both tables are dropped rather
// than left dangling; neither has ever held a row (the catalogue is configured
// through /admin/mesh and mesh has not been sold yet), so nothing is lost.
//
// Rates are integer cents per ft², matching the money-in-cents rule: S$8.00/ft²
// is 800. Both nullable — a category can exist before it is priced. A null sale
// rate means "not yet priced"; a null cost rate means the margin is unreliable.
// meshQuoteWarnings surfaces those as two separate warnings.

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("mesh_categories")
    .addColumn("cost_rmb_cents_per_sqft", "integer")
    .execute();
  await db.schema
    .alterTable("mesh_categories")
    .addColumn("sale_sgd_cents_per_sqft", "integer")
    .execute();

  // mesh_prices first: it references mesh_size_bands.
  await db.schema.dropTable("mesh_prices").execute();
  await db.schema.dropTable("mesh_size_bands").execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Rebuild both tables exactly as 20260806100000 created them — columns,
  // indexes, updated_at triggers and RLS policies — so this migration is
  // genuinely reversible rather than reversible-in-shape-only.
  await db.schema
    .createTable("mesh_size_bands")
    .addColumn("id", "uuid", (c) =>
      c.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("label", "text", (c) => c.notNull())
    .addColumn("max_area_cm2", "integer")
    .addColumn("position", "integer", (c) => c.notNull().defaultTo(0))
    .addColumn("is_active", "boolean", (c) => c.notNull().defaultTo(true))
    .addColumn("created_by", "uuid", (c) => c.references("profiles.id"))
    .addColumn("created_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .addColumn("updated_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await sql`
    create unique index mesh_size_bands_single_open_band
      on public.mesh_size_bands (is_active)
      where max_area_cm2 is null and is_active
  `.execute(db);

  await db.schema
    .createTable("mesh_prices")
    .addColumn("id", "uuid", (c) =>
      c.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("category_id", "uuid", (c) =>
      c.notNull().references("mesh_categories.id"),
    )
    .addColumn("band_id", "uuid", (c) =>
      c.notNull().references("mesh_size_bands.id"),
    )
    .addColumn("cost_rmb_cents", "integer")
    .addColumn("sale_sgd_cents", "integer")
    .addColumn("created_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .addColumn("updated_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .addUniqueConstraint("mesh_prices_category_band_unique", [
      "category_id",
      "band_id",
    ])
    .execute();

  for (const table of ["mesh_size_bands", "mesh_prices"]) {
    await sql`
      create trigger ${sql.raw(table)}_set_updated_at
        before update on public.${sql.raw(table)}
        for each row execute function public.set_updated_at()
    `.execute(db);

    await sql`alter table public.${sql.raw(table)} enable row level security`.execute(
      db,
    );
    await sql`
      create policy ${sql.raw(`"${table}_select_authenticated"`)}
        on public.${sql.raw(table)} for select to authenticated using (true)
    `.execute(db);
    await sql`
      create policy ${sql.raw(`"${table}_insert_admin"`)}
        on public.${sql.raw(table)} for insert to authenticated
        with check (public.is_admin())
    `.execute(db);
    await sql`
      create policy ${sql.raw(`"${table}_update_admin"`)}
        on public.${sql.raw(table)} for update to authenticated
        using (public.is_admin()) with check (public.is_admin())
    `.execute(db);
  }

  await db.schema
    .alterTable("mesh_categories")
    .dropColumn("sale_sgd_cents_per_sqft")
    .execute();
  await db.schema
    .alterTable("mesh_categories")
    .dropColumn("cost_rmb_cents_per_sqft")
    .execute();
}
