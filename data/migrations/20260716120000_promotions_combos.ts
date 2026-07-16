import { sql, type Kysely } from "kysely";

// Phase 10 — two independent pricing levers applied during a consultation:
//  - promotions: admin-managed order-level discount tiers (e.g. "CNY Sale −15%").
//    The applied discount is denormalised onto the order (discount_bps +
//    promo_label) so a saved quote is reproducible even if a tier is later
//    edited/archived.
//  - pricing_combos: admin-managed fixed bundle prices (e.g. "Signature Set →
//    $450/window"). Picked per-window (windows.combo_id) — the combo overrides
//    that window's sale; the real per-metre COGS is unchanged, so margin stays
//    genuine.
// Money = integer cents; rates = integer basis points (×10000). No hard
// deletes — is_active archive. Mirrors the pricing_addons / curtain_series RLS
// + trigger patterns.

export async function up(db: Kysely<unknown>): Promise<void> {
  // ── promotions ─────────────────────────────────────────────────────────
  await db.schema
    .createTable("promotions")
    .addColumn("id", "uuid", (c) =>
      c.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("name", "text", (c) => c.notNull())
    .addColumn("discount_bps", "integer", (c) => c.notNull()) // 15% → 1500
    .addColumn("is_active", "boolean", (c) => c.notNull().defaultTo(true))
    .addColumn("created_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .addColumn("updated_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await sql`create unique index promotions_name_unique on public.promotions (lower(name))`.execute(
    db,
  );
  await sql`
    alter table public.promotions
      add constraint promotions_discount_bps_range
        check (discount_bps between 0 and 10000)
  `.execute(db);
  await sql`
    create trigger promotions_set_updated_at
      before update on public.promotions
      for each row execute function public.set_updated_at()
  `.execute(db);

  // ── pricing_combos ─────────────────────────────────────────────────────
  await db.schema
    .createTable("pricing_combos")
    .addColumn("id", "uuid", (c) =>
      c.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("name", "text", (c) => c.notNull())
    .addColumn("day_series_id", "uuid", (c) =>
      c.references("curtain_series.id"),
    )
    .addColumn("night_series_id", "uuid", (c) =>
      c.references("curtain_series.id"),
    )
    .addColumn("price_sgd_cents", "integer", (c) => c.notNull()) // fixed bundle sale
    .addColumn("is_active", "boolean", (c) => c.notNull().defaultTo(true))
    .addColumn("created_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .addColumn("updated_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await sql`create unique index pricing_combos_name_unique on public.pricing_combos (lower(name))`.execute(
    db,
  );
  await sql`
    alter table public.pricing_combos
      add constraint pricing_combos_price_nonneg check (price_sgd_cents >= 0)
  `.execute(db);
  await sql`
    create trigger pricing_combos_set_updated_at
      before update on public.pricing_combos
      for each row execute function public.set_updated_at()
  `.execute(db);

  // ── orders — applied promotion (denormalised for reproducibility) ──────
  await db.schema
    .alterTable("orders")
    .addColumn("discount_bps", "integer", (c) => c.notNull().defaultTo(0))
    .addColumn("promo_label", "text")
    .execute();
  await sql`
    alter table public.orders
      add constraint orders_discount_bps_range
        check (discount_bps between 0 and 10000)
  `.execute(db);

  // ── windows — the explicitly-picked combo for this window ──────────────
  await db.schema
    .alterTable("windows")
    .addColumn("combo_id", "uuid", (c) => c.references("pricing_combos.id"))
    .execute();

  // ── RLS — authenticated read, admin write (mirror pricing_addons) ──────
  for (const table of ["promotions", "pricing_combos"]) {
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
  await db.schema.alterTable("windows").dropColumn("combo_id").execute();
  await db.schema.alterTable("orders").dropColumn("promo_label").execute();
  await db.schema.alterTable("orders").dropColumn("discount_bps").execute();
  await db.schema.dropTable("pricing_combos").execute();
  await db.schema.dropTable("promotions").execute();
}
