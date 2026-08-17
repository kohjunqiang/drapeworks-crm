import { sql, type Kysely } from "kysely";

// Phase 13B — the manufacturing allowance.
//
// A consultant measures the window opening. The vendor needs something else:
// the opening minus a hem allowance down the height and a clearance allowance
// across the width. Until now that arithmetic happened in someone's head on the
// way into a spreadsheet, with no record of what was sent or why.
//
// Keyed by PRODUCT LINE only — curtain, blind, mesh. Not per series, not per
// vendor, not per blind type. That is a deliberate product decision: three
// numbers a human can hold in their head beat a grid nobody keeps current.
//
// Deltas are stored SIGNED and NEGATIVE: -4 means "four centimetres shorter
// than measured". Storing a signed number rather than a magnitude means a
// future positive allowance needs no schema change and no interpretation flag.
//
// NULL means UNCONFIGURED, which is different from 0 (measured as-is). Curtain
// ships with the known values; blind and mesh are left null on purpose so an
// admin has to enter them, and an order containing an unconfigured line cannot
// be confirmed (see confirmManufactureMeasurements).

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("manufacture_allowances")
    .addColumn("product_line", "text", (c) => c.primaryKey())
    .addColumn("width_delta_cm", "integer")
    .addColumn("height_delta_cm", "integer")
    .addColumn("updated_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .addColumn("updated_by", "uuid", (c) => c.references("profiles.id"))
    .addCheckConstraint(
      "manufacture_allowances_product_line_check",
      sql`product_line in ('curtain','blind','mesh')`,
    )
    .execute();

  await sql`
    create trigger manufacture_allowances_set_updated_at
      before update on public.manufacture_allowances
      for each row execute function public.set_updated_at()
  `.execute(db);

  // Curtain is seeded with the values the business already uses. Blind and mesh
  // are deliberately null — see the header comment.
  await sql`
    insert into public.manufacture_allowances (product_line, width_delta_cm, height_delta_cm)
    values ('curtain', -2, -4), ('blind', null, null), ('mesh', null, null)
  `.execute(db);

  // No insert or delete policy is intentional: the three rows are seeded here
  // and are the complete set. Admins edit them; nobody adds or removes a
  // product line at runtime.
  await sql`alter table public.manufacture_allowances enable row level security`.execute(
    db,
  );
  await sql`
    create policy "manufacture_allowances_select_authenticated"
      on public.manufacture_allowances for select to authenticated using (true)
  `.execute(db);
  await sql`
    create policy "manufacture_allowances_update_admin"
      on public.manufacture_allowances for update to authenticated
      using (public.is_admin()) with check (public.is_admin())
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("manufacture_allowances").execute();
}
