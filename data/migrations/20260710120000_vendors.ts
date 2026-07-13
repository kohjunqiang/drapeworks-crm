import { sql, type Kysely } from "kysely";

// Phase 9 (pricing foundation), slice 1 — vendors. The supplier catalogue the
// pricing feature keys off ("which curtain belongs to which vendor"). Additive
// and non-destructive; mirrors the curtain_series + curtain_types RLS pattern.
// Later slices attach vendor_id + cost/sale columns to curtain_types.

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("vendors")
    .addColumn("id", "uuid", (c) =>
      c.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("code", "text", (c) => c.notNull())
    .addColumn("name", "text", (c) => c.notNull())
    // soft archive — no hard deletes.
    .addColumn("is_active", "boolean", (c) => c.notNull().defaultTo(true))
    .addColumn("notes", "text")
    .addColumn("created_by", "uuid", (c) => c.references("profiles.id"))
    .addColumn("created_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .addColumn("updated_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .execute();

  // Case-insensitive unique code — no duplicate vendor IDs.
  await sql`create unique index vendors_code_unique on public.vendors (lower(code))`.execute(
    db,
  );

  await sql`
    create trigger vendors_set_updated_at
      before update on public.vendors
      for each row execute function public.set_updated_at()
  `.execute(db);

  await db.schema
    .createIndex("vendors_active_idx")
    .on("vendors")
    .column("is_active")
    .execute();

  // RLS — mirror curtain_series: authenticated read, admin write, no delete.
  await sql`alter table public.vendors enable row level security`.execute(db);
  await sql`
    create policy "vendors_select_authenticated"
      on public.vendors for select to authenticated using (true)
  `.execute(db);
  await sql`
    create policy "vendors_insert_admin"
      on public.vendors for insert to authenticated
      with check (public.is_admin())
  `.execute(db);
  await sql`
    create policy "vendors_update_admin"
      on public.vendors for update to authenticated
      using (public.is_admin()) with check (public.is_admin())
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Drops its trigger + indexes + policies with it.
  await db.schema.dropTable("vendors").execute();
}
