import { sql, type Kysely } from "kysely";

// Phase 9 — pricing settings the calculator will read: a single-row global
// assumptions table + an add-ons price list. Seeded with the Excel's values as
// editable defaults. Money = integer cents; rates/multipliers = integers scaled
// ×10000 (so ratio 1.0 = 10000; 9% = 900; 5.3 = 53000).

export async function up(db: Kysely<unknown>): Promise<void> {
  // ── pricing_addon_basis enum ───────────────────────────────────────────
  await sql`create type pricing_addon_basis as enum ('per_metre', 'per_unit')`.execute(
    db,
  );

  // ── pricing_assumptions (single row, id=true guard) ────────────────────
  await db.schema
    .createTable("pricing_assumptions")
    .addColumn("singleton", "boolean", (c) =>
      c.primaryKey().defaultTo(true).check(sql`singleton`),
    )
    .addColumn("fx_sgd_to_rmb", "integer", (c) => c.notNull()) // ×10000 (5.3 → 53000)
    .addColumn("gst_bps", "integer", (c) => c.notNull()) // 9% → 900
    .addColumn("other_cost_bps", "integer", (c) => c.notNull()) // 10% → 1000
    .addColumn("premium_bps", "integer", (c) => c.notNull()) // 1.15 → 11500
    .addColumn("groupbuy_discount_bps", "integer", (c) => c.notNull()) // 15% → 1500
    .addColumn("style_multiplier", "integer", (c) => c.notNull()) // 2.0 → 20000
    .addColumn("handyman_sgd_cents", "integer", (c) => c.notNull()) // $100 → 10000
    .addColumn("sea_freight_rmb_cents_per_m3", "integer", (c) => c.notNull()) // ¥400 → 40000
    .addColumn("air_freight_rate_bps", "integer", (c) => c.notNull()) // 60% → 6000
    .addColumn("air_freight_floor_rmb_cents", "integer", (c) => c.notNull()) // ¥500 → 50000
    .addColumn("air_freight_cap_rmb_cents", "integer", (c) => c.notNull()) // ¥1400 → 140000
    .addColumn("min_margin_bps", "integer", (c) => c.notNull()) // 35% → 3500
    .addColumn("min_margin_carousell_bps", "integer", (c) => c.notNull()) // 30% → 3000
    .addColumn("updated_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .execute();

  // Seed the single row with the Excel defaults (editable on the settings page).
  await sql`
    insert into public.pricing_assumptions
      (singleton, fx_sgd_to_rmb, gst_bps, other_cost_bps, premium_bps,
       groupbuy_discount_bps, style_multiplier, handyman_sgd_cents,
       sea_freight_rmb_cents_per_m3, air_freight_rate_bps,
       air_freight_floor_rmb_cents, air_freight_cap_rmb_cents,
       min_margin_bps, min_margin_carousell_bps)
    values
      (true, 53000, 900, 1000, 11500, 1500, 20000, 10000,
       40000, 6000, 50000, 140000, 3500, 3000)
  `.execute(db);

  await sql`
    create trigger pricing_assumptions_set_updated_at
      before update on public.pricing_assumptions
      for each row execute function public.set_updated_at()
  `.execute(db);

  // ── pricing_addons ─────────────────────────────────────────────────────
  await db.schema
    .createTable("pricing_addons")
    .addColumn("id", "uuid", (c) =>
      c.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("key", "text", (c) => c.notNull())
    .addColumn("label", "text", (c) => c.notNull())
    .addColumn("cost_rmb_cents", "integer")
    .addColumn("sale_sgd_cents", "integer")
    .addColumn("basis", sql`pricing_addon_basis`, (c) =>
      c.notNull().defaultTo("per_metre"),
    )
    .addColumn("is_active", "boolean", (c) => c.notNull().defaultTo(true))
    .addColumn("created_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .addColumn("updated_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .execute();
  await sql`create unique index pricing_addons_key_unique on public.pricing_addons (key)`.execute(
    db,
  );
  await sql`
    alter table public.pricing_addons
      add constraint pricing_addons_cost_nonneg
        check (cost_rmb_cents is null or cost_rmb_cents >= 0),
      add constraint pricing_addons_sale_nonneg
        check (sale_sgd_cents is null or sale_sgd_cents >= 0)
  `.execute(db);
  await sql`
    create trigger pricing_addons_set_updated_at
      before update on public.pricing_addons
      for each row execute function public.set_updated_at()
  `.execute(db);

  // Seed the known add-ons from the Excel (editable).
  await sql`
    insert into public.pricing_addons (key, label, cost_rmb_cents, sale_sgd_cents, basis)
    values
      ('blackout', 'Blackout', 2700, 5000, 'per_metre'),
      ('s_fold', 'S-Fold', 1100, 8000, 'per_metre'),
      ('slim_tracks', 'Slim Tracks', 3500, 5000, 'per_metre'),
      ('single_track', 'Single Track', 2500, 3500, 'per_unit'),
      ('double_track', 'Double Track', 2500, 4000, 'per_unit'),
      ('blinds_surcharge', 'Blinds Surcharge', null, 13000, 'per_unit')
  `.execute(db);

  // ── RLS — authenticated read, admin write (mirror curtain_series) ──────
  for (const table of ["pricing_assumptions", "pricing_addons"]) {
    await sql`alter table ${sql.raw(`public.${table}`)} enable row level security`.execute(
      db,
    );
    await sql`
      create policy ${sql.raw(`"${table}_select_authenticated"`)}
        on ${sql.raw(`public.${table}`)} for select to authenticated using (true)
    `.execute(db);
    await sql`
      create policy ${sql.raw(`"${table}_insert_admin"`)}
        on ${sql.raw(`public.${table}`)} for insert to authenticated
        with check (public.is_admin())
    `.execute(db);
    await sql`
      create policy ${sql.raw(`"${table}_update_admin"`)}
        on ${sql.raw(`public.${table}`)} for update to authenticated
        using (public.is_admin()) with check (public.is_admin())
    `.execute(db);
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("pricing_addons").execute();
  await db.schema.dropTable("pricing_assumptions").execute();
  await sql`drop type pricing_addon_basis`.execute(db);
}
