import { sql, type Kysely } from "kysely";

// Phase 11 — the Mesh product line (window insect/security mesh). Adds a
// product_line discriminator to orders and a self-contained set of mesh tables
// alongside the curtain ones, rather than widening `windows` with columns that
// are null for every curtain row. See docs/specs/phase-11-mesh-product-line.md.
//
// Additive: every existing order backfills to 'curtain' via the column default,
// and no curtain table changes shape.

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`create type product_line as enum ('curtain', 'mesh')`.execute(db);
  await sql`
    create type mesh_draw_direction as enum (
      'Single Left', 'Single Right', 'Single Top', 'Single Bottom', 'Double'
    )
  `.execute(db);

  await db.schema
    .alterTable("orders")
    .addColumn("product_line", sql`product_line`, (c) =>
      c.notNull().defaultTo("curtain"),
    )
    .execute();

  // Handyman drill + silicone per installed panel. A cost we bear, never a
  // customer line item — same treatment as the curtain handyman charges.
  await db.schema
    .alterTable("pricing_assumptions")
    .addColumn("handyman_mesh_sgd_cents", "integer", (c) =>
      c.notNull().defaultTo(0),
    )
    .execute();

  // ── catalogue: categories ────────────────────────────────────────────
  await db.schema
    .createTable("mesh_categories")
    .addColumn("id", "uuid", (c) =>
      c.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("name", "text", (c) => c.notNull())
    .addColumn("description", "text")
    .addColumn("vendor_id", "uuid", (c) => c.references("vendors.id"))
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

  await sql`create unique index mesh_categories_name_unique on public.mesh_categories (lower(name))`.execute(
    db,
  );

  // ── catalogue: colours (one global list, shared by all categories) ────
  await db.schema
    .createTable("mesh_colours")
    .addColumn("id", "uuid", (c) =>
      c.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("name", "text", (c) => c.notNull())
    // Flat per-panel surcharge, not scaled by area — matches the flat
    // per-panel pricing basis. Null = no surcharge.
    .addColumn("surcharge_rmb_cents", "integer")
    .addColumn("surcharge_sgd_cents", "integer")
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

  await sql`create unique index mesh_colours_name_unique on public.mesh_colours (lower(name))`.execute(
    db,
  );

  // ── catalogue: size bands ────────────────────────────────────────────
  // Area in cm² (width_cm × height_cm) as an integer, so band matching stays
  // integer arithmetic with no float drift. 2 m² = 20000.
  await db.schema
    .createTable("mesh_size_bands")
    .addColumn("id", "uuid", (c) =>
      c.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("label", "text", (c) => c.notNull())
    // Null = the open-ended top band.
    .addColumn("max_area_cm2", "integer")
    // Display order only. The price lookup orders by max_area_cm2, never by
    // this — pricing correctness must not depend on a display column.
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

  // At most one ACTIVE open-ended band, else the price lookup is
  // nondeterministic. Every row the predicate admits has is_active = true, so
  // a unique index on that column permits exactly one.
  await sql`
    create unique index mesh_size_bands_single_open_band
      on public.mesh_size_bands (is_active)
      where max_area_cm2 is null and is_active
  `.execute(db);

  // ── price book: category × band ──────────────────────────────────────
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
    // Both nullable — a grid cell can exist before anyone fills it in. A null
    // sale means "not yet priced"; a null cost means the margin is unreliable.
    // Both are surfaced by meshQuoteWarnings, as separate warnings.
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

  // ── line item ────────────────────────────────────────────────────────
  await db.schema
    .createTable("mesh_panels")
    .addColumn("id", "uuid", (c) =>
      c.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("room_id", "uuid", (c) =>
      c.notNull().references("rooms.id").onDelete("cascade"),
    )
    .addColumn("position", "integer", (c) => c.notNull())
    .addColumn("category_id", "uuid", (c) => c.references("mesh_categories.id"))
    .addColumn("colour_id", "uuid", (c) => c.references("mesh_colours.id"))
    // All product columns nullable so a draft consultation can be saved
    // half-finished, matching `windows`. No updated_at, also matching `windows`.
    .addColumn("width_cm", "integer")
    .addColumn("height_cm", "integer")
    // Depth of the window recess, measured on site — decides whether the frame
    // fits inside the reveal or must be face-mounted. Does not affect price.
    .addColumn("depth_cm", "integer")
    .addColumn("draw", sql`mesh_draw_direction`)
    // Double draw only: the two sliding leaf widths. Recorded as cm rather than
    // a preset ratio so any split is expressible and the factory gets exact
    // numbers. Nulled by the server actions when draw is not 'Double'.
    .addColumn("split_left_cm", "integer")
    .addColumn("split_right_cm", "integer")
    .addColumn("notes", "text")
    .addColumn("created_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .execute();

  // Composite, matching windows_room_idx — panels are always read ordered by
  // position within a room.
  await db.schema
    .createIndex("mesh_panels_room_idx")
    .on("mesh_panels")
    .columns(["room_id", "position"])
    .execute();

  // ── updated_at triggers ──────────────────────────────────────────────
  for (const table of [
    "mesh_categories",
    "mesh_colours",
    "mesh_size_bands",
    "mesh_prices",
  ]) {
    await sql`
      create trigger ${sql.raw(table)}_set_updated_at
        before update on public.${sql.raw(table)}
        for each row execute function public.set_updated_at()
    `.execute(db);
  }

  // ── RLS ──────────────────────────────────────────────────────────────
  // Catalogue tables mirror `vendors`: authenticated read, admin write, no
  // delete (soft archive via is_active).
  for (const table of [
    "mesh_categories",
    "mesh_colours",
    "mesh_size_bands",
    "mesh_prices",
  ]) {
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

  // mesh_panels mirrors `windows`: everyone reads, the owning consultant or an
  // admin writes.
  await sql`alter table public.mesh_panels enable row level security`.execute(
    db,
  );
  await sql`
    create policy "mesh_panels_select_authenticated"
      on public.mesh_panels for select to authenticated using (true)
  `.execute(db);
  await sql`
    create policy "mesh_panels_write_owner_admin"
      on public.mesh_panels for all to authenticated
      using (
        exists (
          select 1 from public.rooms r
            join public.orders o on o.id = r.order_id
          where r.id = mesh_panels.room_id
            and (o.consultant_id = auth.uid() or public.is_admin())
        )
      )
      with check (
        exists (
          select 1 from public.rooms r
            join public.orders o on o.id = r.order_id
          where r.id = mesh_panels.room_id
            and (o.consultant_id = auth.uid() or public.is_admin())
        )
      )
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Order matters: a Postgres type can't be dropped while a column still uses
  // it, so the enum types go last. Dropping a table takes its triggers,
  // indexes and policies with it.
  await db.schema.dropTable("mesh_panels").execute();
  await db.schema.dropTable("mesh_prices").execute();
  await db.schema.dropTable("mesh_categories").execute();
  await db.schema.dropTable("mesh_colours").execute();
  await db.schema.dropTable("mesh_size_bands").execute();

  await db.schema
    .alterTable("pricing_assumptions")
    .dropColumn("handyman_mesh_sgd_cents")
    .execute();
  await db.schema.alterTable("orders").dropColumn("product_line").execute();

  await sql`drop type mesh_draw_direction`.execute(db);
  await sql`drop type product_line`.execute(db);
}
