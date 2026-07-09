import { sql, type Kysely } from "kysely";

// Phase 8b — curtain-type series (physical category), running per-series index,
// and sample-book page. Additive/non-destructive: mirrors the curtain_types +
// fabrics RLS pattern.

export async function up(db: Kysely<unknown>): Promise<void> {
  // ── curtain_series ────────────────────────────────────────────────────
  await db.schema
    .createTable("curtain_series")
    .addColumn("id", "uuid", (c) =>
      c.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("name", "text", (c) => c.notNull())
    // soft archive — no hard deletes.
    .addColumn("is_active", "boolean", (c) => c.notNull().defaultTo(true))
    .addColumn("created_by", "uuid", (c) => c.references("profiles.id"))
    .addColumn("created_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .addColumn("updated_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .execute();

  // Case-insensitive unique name — no duplicate series.
  await sql`create unique index curtain_series_name_unique on public.curtain_series (lower(name))`.execute(
    db,
  );

  await sql`
    create trigger curtain_series_set_updated_at
      before update on public.curtain_series
      for each row execute function public.set_updated_at()
  `.execute(db);

  await db.schema
    .createIndex("curtain_series_active_idx")
    .on("curtain_series")
    .column("is_active")
    .execute();

  // RLS — mirror curtain_types: authenticated read, admin write, no delete.
  await sql`alter table public.curtain_series enable row level security`.execute(
    db,
  );
  await sql`
    create policy "curtain_series_select_authenticated"
      on public.curtain_series for select to authenticated using (true)
  `.execute(db);
  await sql`
    create policy "curtain_series_insert_admin"
      on public.curtain_series for insert to authenticated
      with check (public.is_admin())
  `.execute(db);
  await sql`
    create policy "curtain_series_update_admin"
      on public.curtain_series for update to authenticated
      using (public.is_admin()) with check (public.is_admin())
  `.execute(db);

  // ── curtain_types additions ───────────────────────────────────────────
  await db.schema
    .alterTable("curtain_types")
    .addColumn("series_id", "uuid", (c) => c.references("curtain_series.id"))
    .addColumn("series_index", "integer")
    .addColumn("page", "text")
    .execute();

  // One index per slot within a series (backstop against concurrent-add races).
  await sql`
    create unique index curtain_types_series_index_unique
      on public.curtain_types (series_id, series_index)
      where series_id is not null and series_index is not null
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop index if exists public.curtain_types_series_index_unique`.execute(
    db,
  );
  await db.schema.alterTable("curtain_types").dropColumn("page").execute();
  await db.schema
    .alterTable("curtain_types")
    .dropColumn("series_index")
    .execute();
  await db.schema.alterTable("curtain_types").dropColumn("series_id").execute();

  // curtain_series (drops its trigger + indexes with it).
  await db.schema.dropTable("curtain_series").execute();
}
