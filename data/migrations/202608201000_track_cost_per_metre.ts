import { sql, type Kysely } from "kysely";

// The rail stops being an add-on and becomes one cost per metre.
//
// It was two rows in pricing_addons ('single_track', 'double_track'), each with
// a sale price and a per-metre/per-unit basis. All three of those were wrong:
//
//  - The sale price was never read. windowQuote hardcodes the rail's sale to 0
//    because a rail is a cost we bear and never bill, so the S$35/S$40 sitting
//    in those rows was an editable number that did nothing.
//  - The basis dropdown was a trap. The calculator asked for the rail's price
//    with no width, so switching either row to "Per metre" in the admin screen
//    returned ZERO — track cost silently vanished from COGS and the margin went
//    up. Nothing warned anybody.
//  - Two rows implied two rates. A double rail is two runs of the SAME rail, so
//    it is twice the width at one rate, not a second price to keep in step.
//
// The rate carried over here is the old per-unit cost (¥25), which is a
// PLACEHOLDER: it used to buy one whole rail and now buys one metre. Set the
// real figure under Admin → Pricing Settings.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("pricing_assumptions")
    .addColumn("track_cost_rmb_cents_per_m", "integer", (c) =>
      c.notNull().defaultTo(2500),
    )
    .execute();

  await sql`
    alter table public.pricing_assumptions
      add constraint pricing_assumptions_track_cost_nonneg
        check (track_cost_rmb_cents_per_m >= 0)
  `.execute(db);

  // Archived, not deleted: an add-on row is referenced by nothing, but the
  // house rule is that history stays readable. Archiving also takes them out of
  // the admin list, so nobody can edit a price the calculator no longer reads.
  await sql`
    update public.pricing_addons
      set is_active = false
      where key in ('single_track', 'double_track')
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    update public.pricing_addons
      set is_active = true
      where key in ('single_track', 'double_track')
  `.execute(db);

  await sql`
    alter table public.pricing_assumptions
      drop constraint if exists pricing_assumptions_track_cost_nonneg
  `.execute(db);

  await db.schema
    .alterTable("pricing_assumptions")
    .dropColumn("track_cost_rmb_cents_per_m")
    .execute();
}
