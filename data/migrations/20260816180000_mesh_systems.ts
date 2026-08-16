import { sql, type Kysely } from "kysely";

// Phase 11 — the physical dimensions of each track system.
//
// The system matrix (20260816160000) says WHICH system a panel needs. This says
// what that system physically costs you in width and height, which is what the
// track length is derived from:
//
//   single draw:  track = width − (roller + handle) − side track
//
// Everything is stored in integer MILLIMETRES. The supplier's figures carry one
// decimal place in cm (6.5, 4.3, 1.5) and the resulting track length does too
// (185.2), so centimetres would force floats into a measurement chain — exactly
// what the money-in-cents rule exists to prevent. Millimetres keep it exact
// integer arithmetic with a single formatting step at the end.
//
// Seeded with the three shipped systems, same reasoning as the matrix: these
// are supplier specifications, identical for every customer, and typing five
// numbers per system by hand invites a transposition nobody would notice until
// a panel came back the wrong size.
//
// Linked to the matrix by NAME rather than a foreign key: the matrix stores the
// system as free text an admin types, and matching is case-insensitive and
// trimmed. A name with no row here means the track simply cannot be computed —
// surfaced as "not configured", never as a wrong number.

const SYSTEMS = [
  // name, roller, handle, side track, track height, track depth  (all mm)
  ["System 55", 65, 43, 15, 25, 36],
  ["System 68", 78, 55, 15, 25, 36],
  ["System 80", 90, 55, 15, 25, 36],
] as const;

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("mesh_systems")
    .addColumn("id", "uuid", (c) =>
      c.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("name", "text", (c) => c.notNull())
    // The roller and handle stack on the leading edge. Together they are what
    // the track loses on a single draw.
    .addColumn("roller_mm", "integer", (c) => c.notNull())
    .addColumn("handle_mm", "integer", (c) => c.notNull())
    // The fixed track down the far side.
    .addColumn("side_track_mm", "integer", (c) => c.notNull())
    // The top and bottom rail profile. Height comes off the opening; depth is
    // what the reveal has to accommodate.
    .addColumn("track_height_mm", "integer", (c) => c.notNull())
    .addColumn("track_depth_mm", "integer", (c) => c.notNull())
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

  // Case-insensitive, because the matrix links by name and "system 55" and
  // "System 55" must not become two different systems.
  await sql`create unique index mesh_systems_name_unique on public.mesh_systems (lower(name))`.execute(
    db,
  );

  await sql`
    create trigger mesh_systems_set_updated_at
      before update on public.mesh_systems
      for each row execute function public.set_updated_at()
  `.execute(db);

  await sql`alter table public.mesh_systems enable row level security`.execute(
    db,
  );
  await sql`
    create policy "mesh_systems_select_authenticated"
      on public.mesh_systems for select to authenticated using (true)
  `.execute(db);
  await sql`
    create policy "mesh_systems_insert_admin"
      on public.mesh_systems for insert to authenticated
      with check (public.is_admin())
  `.execute(db);
  await sql`
    create policy "mesh_systems_update_admin"
      on public.mesh_systems for update to authenticated
      using (public.is_admin()) with check (public.is_admin())
  `.execute(db);

  for (const [
    i,
    [name, roller, handle, side, height, depth],
  ] of SYSTEMS.entries()) {
    await sql`
      insert into public.mesh_systems
        (name, roller_mm, handle_mm, side_track_mm,
         track_height_mm, track_depth_mm, position)
      values (${name}, ${roller}, ${handle}, ${side},
              ${height}, ${depth}, ${i})
    `.execute(db);
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("mesh_systems").execute();
}
