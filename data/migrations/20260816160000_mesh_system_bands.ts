import { sql, type Kysely } from "kysely";

// Phase 11 — the system matrix.
//
// The mesh runs on a track system (System 55 / 68 / 80). Which one a panel
// needs is decided by the total window width and whether it is a single or
// double draw — a wider opening needs a heavier profile, and splitting it into
// two leaves halves what each leaf has to carry, so a double draw can use a
// lighter system than a single draw of the same width. Past a certain width a
// single draw is not buildable at all.
//
// This is engineering data, not commercial data: it is a property of the
// product, identical for every customer. So unlike the categories, colours and
// rates it ships with its canonical values already in place, and the admin
// edits them rather than entering them from scratch.
//
// Resolution is `the first band, by ascending max_width_cm, where
// width_cm <= max_width_cm`. A null system means that combination is not
// possible; so does a width past the last band. There is deliberately no
// open-ended band — "wider than anything we build" must stay an error rather
// than silently resolving to the heaviest profile.
//
// The system does NOT affect price. It is printed on the order for the factory;
// the quote stays area x the category's per-ft2 rate.

const BANDS = [
  // max_width_cm, single, double
  [150, "System 55", "System 55"],
  [250, "System 68", "System 55"],
  [300, "System 80", "System 55"],
  [380, "System 80", "System 68"],
  [500, null, "System 68"],
  [760, null, "System 80"],
] as const;

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("mesh_system_bands")
    .addColumn("id", "uuid", (c) =>
      c.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    // Inclusive upper bound of the band, in cm — the same integer unit the
    // panel measurements use, so matching never touches a float.
    .addColumn("max_width_cm", "integer", (c) => c.notNull())
    // Null = that draw is not possible at this width.
    .addColumn("single_system", "text")
    .addColumn("double_system", "text")
    // Display order only. Resolution orders by max_width_cm, never by this.
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

  // Two active bands sharing an upper bound would make resolution depend on
  // row order. Archived rows are excluded so a band can be replaced.
  await sql`
    create unique index mesh_system_bands_max_width_unique
      on public.mesh_system_bands (max_width_cm)
      where is_active
  `.execute(db);

  await sql`
    create trigger mesh_system_bands_set_updated_at
      before update on public.mesh_system_bands
      for each row execute function public.set_updated_at()
  `.execute(db);

  // Mirrors the other mesh catalogue tables: authenticated read, admin write,
  // no delete.
  await sql`alter table public.mesh_system_bands enable row level security`.execute(
    db,
  );
  await sql`
    create policy "mesh_system_bands_select_authenticated"
      on public.mesh_system_bands for select to authenticated using (true)
  `.execute(db);
  await sql`
    create policy "mesh_system_bands_insert_admin"
      on public.mesh_system_bands for insert to authenticated
      with check (public.is_admin())
  `.execute(db);
  await sql`
    create policy "mesh_system_bands_update_admin"
      on public.mesh_system_bands for update to authenticated
      using (public.is_admin()) with check (public.is_admin())
  `.execute(db);

  for (const [i, [maxWidth, single, double]] of BANDS.entries()) {
    await sql`
      insert into public.mesh_system_bands
        (max_width_cm, single_system, double_system, position)
      values (${maxWidth}, ${single}, ${double}, ${i})
    `.execute(db);
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("mesh_system_bands").execute();
}
