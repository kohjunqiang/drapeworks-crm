import { sql, type Kysely } from "kysely";

// Phase 11 — minimum billable area per panel.
//
// A small panel still costs a full frame, a full trip and a minimum order from
// the supplier, so each one bills at no less than a floor area. The AREA is
// floored, not the price: `billable = max(measured, minimum)`, and everything
// downstream — the per-ft² rate, the colour and double-draw surcharges, freight,
// margin — is unchanged.
//
// The floor is stored PER LEAF and multiplied by the number of leaves, because
// that is what the supplier's table describes: a single draw takes one minimum,
// a double takes two. MaxGuard on System 55 is 2 m² single and "2 × 2" double,
// on System 68 it is 2.5 and "2 × 2.5", and so on — the double figure is always
// exactly twice the single, which is the tell that it is one minimum applied to
// each leaf rather than two independent numbers.
//
// Keyed by (category, system) because it varies on both axes: MaxGuard's floor
// climbs with the system, while AirGuard and HomeGuard hold the same floor
// whatever system they land on. A grid of explicit cells rather than a default
// with overrides — there is no hidden fallback to reason about when a number
// looks wrong.
//
// Areas are integer cm², the same unit `panelAreaCm2` already produces, so the
// comparison never touches a float. 2 m² is 20000.
//
// It floors COST as well as SALE. Flooring the sale alone would report a margin
// that climbs on every under-minimum panel, which is exactly the sort of
// flattering error that gets found in a P&L rather than on screen.

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("mesh_minimum_areas")
    .addColumn("id", "uuid", (c) =>
      c.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("category_id", "uuid", (c) =>
      c.notNull().references("mesh_categories.id"),
    )
    .addColumn("system_id", "uuid", (c) =>
      c.notNull().references("mesh_systems.id"),
    )
    .addColumn("min_area_cm2_per_leaf", "integer", (c) => c.notNull())
    .addColumn("created_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .addColumn("updated_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .addUniqueConstraint("mesh_minimum_areas_category_system_unique", [
      "category_id",
      "system_id",
    ])
    .execute();

  await sql`
    create trigger mesh_minimum_areas_set_updated_at
      before update on public.mesh_minimum_areas
      for each row execute function public.set_updated_at()
  `.execute(db);

  await sql`alter table public.mesh_minimum_areas enable row level security`.execute(
    db,
  );
  await sql`
    create policy "mesh_minimum_areas_select_authenticated"
      on public.mesh_minimum_areas for select to authenticated using (true)
  `.execute(db);
  await sql`
    create policy "mesh_minimum_areas_insert_admin"
      on public.mesh_minimum_areas for insert to authenticated
      with check (public.is_admin())
  `.execute(db);
  await sql`
    create policy "mesh_minimum_areas_update_admin"
      on public.mesh_minimum_areas for update to authenticated
      using (public.is_admin()) with check (public.is_admin())
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("mesh_minimum_areas").execute();
}
