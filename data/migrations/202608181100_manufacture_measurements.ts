import { sql, type Kysely } from "kysely";

// Phase 13B — what we are actually going to build, as opposed to what we
// measured.
//
// One row per line item: a window OR a mesh panel, never both, enforced by a
// check constraint. One polymorphic table rather than two because the
// reconciliation screen, the costing lookup and the vendor sheet all want a
// single uniform list; two tables would double every code path for no gain.
//
// order_id is denormalised (it is reachable via window -> room -> order)
// because every read is by order, and the alternative is a three-table join on
// every one of them.
//
// source_width_cm / source_height_cm are a SNAPSHOT taken at confirmation, not
// a reference. windows.width_cm is never modified — this is a second set of
// data, not a replacement — but the record has to stay truthful on its own
// terms, so that "what did we send the vendor, and what did we base it on" does
// not depend on the source row having survived unchanged.
//
// Rows are written on confirmation only. The reconciliation screen computes
// candidates live and holds overrides in component state; nothing is persisted
// until a human confirms.

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("manufacture_measurements")
    .addColumn("id", "uuid", (c) =>
      c.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("order_id", "uuid", (c) =>
      c.notNull().references("orders.id").onDelete("cascade"),
    )
    .addColumn("window_id", "uuid", (c) =>
      c.references("windows.id").onDelete("cascade"),
    )
    .addColumn("mesh_panel_id", "uuid", (c) =>
      c.references("mesh_panels.id").onDelete("cascade"),
    )
    .addColumn("source_width_cm", "integer", (c) => c.notNull())
    .addColumn("source_height_cm", "integer", (c) => c.notNull())
    .addColumn("width_delta_cm", "integer", (c) => c.notNull())
    .addColumn("height_delta_cm", "integer", (c) => c.notNull())
    .addColumn("mfg_width_cm", "integer", (c) => c.notNull())
    .addColumn("mfg_height_cm", "integer", (c) => c.notNull())
    .addColumn("is_overridden", "boolean", (c) => c.notNull().defaultTo(false))
    .addColumn("override_reason", "text")
    .addColumn("confirmed_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .addColumn("confirmed_by", "uuid", (c) => c.references("profiles.id"))
    .addColumn("updated_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .addCheckConstraint(
      "mm_exactly_one_line_item",
      sql`(window_id is not null and mesh_panel_id is null)
       or (window_id is null and mesh_panel_id is not null)`,
    )
    .addCheckConstraint(
      "mm_override_has_reason",
      sql`not is_overridden
       or (override_reason is not null and length(trim(override_reason)) > 0)`,
    )
    .addCheckConstraint(
      "mm_positive_manufacturing_dims",
      sql`mfg_width_cm > 0 and mfg_height_cm > 0`,
    )
    .execute();

  // Partial unique indexes rather than plain unique constraints: a line item
  // has at most one manufacturing record, but the other column is null on
  // every row, and a plain unique index over a nullable column would not say
  // that.
  await sql`
    create unique index mm_window_key on public.manufacture_measurements (window_id)
      where window_id is not null
  `.execute(db);
  await sql`
    create unique index mm_mesh_panel_key on public.manufacture_measurements (mesh_panel_id)
      where mesh_panel_id is not null
  `.execute(db);
  await sql`
    create index mm_order_idx on public.manufacture_measurements (order_id)
  `.execute(db);

  await sql`
    create trigger manufacture_measurements_set_updated_at
      before update on public.manufacture_measurements
      for each row execute function public.set_updated_at()
  `.execute(db);

  // The absence of a delete policy is deliberate. Nothing hard-deletes here:
  // an amendment updates the row in place and writes an audit note to the
  // status timeline, so the history of what a vendor was told stays intact.
  // Ops may confirm an order's measurements; only an admin may amend them
  // afterwards, because by then the numbers have already left the building.
  await sql`alter table public.manufacture_measurements enable row level security`.execute(
    db,
  );
  await sql`
    create policy "manufacture_measurements_select_authenticated"
      on public.manufacture_measurements for select to authenticated using (true)
  `.execute(db);
  await sql`
    create policy "manufacture_measurements_insert_ops_admin"
      on public.manufacture_measurements for insert to authenticated
      with check (public.is_ops() or public.is_admin())
  `.execute(db);
  await sql`
    create policy "manufacture_measurements_update_admin"
      on public.manufacture_measurements for update to authenticated
      using (public.is_admin()) with check (public.is_admin())
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("manufacture_measurements").execute();
}
