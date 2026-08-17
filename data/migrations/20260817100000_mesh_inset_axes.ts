import { sql, type Kysely } from "kysely";

// Phase 11 — insets split by axis, and the clearance a horizontal one costs.
//
// A single `has_inset` flag turned out to conflate two different site
// conditions. Wall to the LEFT and RIGHT of the opening (a horizontal inset)
// constrains the track: it has to be cut short so the panel can be tilted into
// place, which costs a fixed clearance. Wall ABOVE and BELOW (a vertical inset)
// constrains the height instead and does not touch the track.
//
// So they are recorded separately. A panel can have either, both or neither.
//
// The clearance lives on the system rather than as a constant in the
// calculator: it is a physical allowance that a supplier could revise, and
// every other dimension in this feature is already editable in the admin. It
// is seeded to 5 mm (0.5 cm), the figure in use today.

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("mesh_panels")
    .addColumn("has_inset_horizontal", "boolean", (c) =>
      c.notNull().defaultTo(false),
    )
    .execute();
  await db.schema
    .alterTable("mesh_panels")
    .addColumn("has_inset_vertical", "boolean", (c) =>
      c.notNull().defaultTo(false),
    )
    .execute();

  // Carry the old flag across as a horizontal inset: that is the reading that
  // changes the track, so it is the safe one to assume. No mesh order exists
  // at the time of writing, but the statement keeps `up()` honest if one does.
  await sql`
    update public.mesh_panels
       set has_inset_horizontal = true
     where has_inset
  `.execute(db);

  await db.schema.alterTable("mesh_panels").dropColumn("has_inset").execute();

  await db.schema
    .alterTable("mesh_systems")
    .addColumn("inset_deduction_mm", "integer", (c) =>
      c.notNull().defaultTo(5),
    )
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("mesh_systems")
    .dropColumn("inset_deduction_mm")
    .execute();

  await db.schema
    .alterTable("mesh_panels")
    .addColumn("has_inset", "boolean", (c) => c.notNull().defaultTo(false))
    .execute();

  // Collapse both axes back into the single flag rather than losing a vertical
  // inset entirely.
  await sql`
    update public.mesh_panels
       set has_inset = true
     where has_inset_horizontal or has_inset_vertical
  `.execute(db);

  await db.schema
    .alterTable("mesh_panels")
    .dropColumn("has_inset_vertical")
    .execute();
  await db.schema
    .alterTable("mesh_panels")
    .dropColumn("has_inset_horizontal")
    .execute();
}
