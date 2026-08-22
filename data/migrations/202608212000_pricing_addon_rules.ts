import { sql, type Kysely } from "kysely";

// Phase 14 — an add-on stops being a hard-coded column and becomes a row an
// admin maintains. Three columns carry what the code used to know by name:
// which covering offers it, and whether it is ticked by hand or by a rule.

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`create type pricing_addon_scope as enum ('curtain', 'blind', 'both')`.execute(
    db,
  );
  await sql`create type pricing_addon_auto_rule as enum ('manual', 'always', 'width_over')`.execute(
    db,
  );

  // 'curtain' / 'manual' are chosen so the two live add-ons (s_fold,
  // slim_tracks) land correctly with no update, and so a row added by hand
  // later fails SAFE: visible on curtains, never silently auto-charged.
  await db.schema
    .alterTable("pricing_addons")
    .addColumn("applies_to", sql`pricing_addon_scope`, (c) =>
      c.notNull().defaultTo("curtain"),
    )
    .addColumn("auto_rule", sql`pricing_addon_auto_rule`, (c) =>
      c.notNull().defaultTo("manual"),
    )
    .addColumn("auto_width_over_cm", "integer")
    .execute();

  // The threshold and the rule cannot disagree. Without this, a 'width_over'
  // row with a null threshold is a silent no-op that looks configured.
  await sql`
    alter table public.pricing_addons
      add constraint pricing_addons_auto_width_agrees
        check (
          (auto_rule = 'width_over'
             and auto_width_over_cm is not null and auto_width_over_cm > 0)
          or (auto_rule <> 'width_over' and auto_width_over_cm is null)
        )
  `.execute(db);

  await sql`
    update public.pricing_addons set applies_to = 'blind' where key = 'blinds_surcharge'
  `.execute(db);
  // Blackout is sold on both product lines.
  await sql`
    update public.pricing_addons set applies_to = 'both' where key = 'blackout'
  `.execute(db);

  // blinds_surcharge deliberately keeps auto_rule = 'manual'. Its live values
  // are 0/0 on a basis nobody chose, contradicting the Phase-9 seed. Wiring an
  // unpriced row as always-applied is a landmine: the day someone prices it,
  // every subsequent blind re-prices while already-quoted ones do not. It also
  // charges nothing, so the resolver keeps it off the form until it is priced.

  // Extra shipping: a blind over 2m wide ships in a non-standard carton.
  // Unpriced on purpose — we are not inventing a figure. The admin screen
  // flags it, and the resolver hides it until it has one.
  await sql`
    insert into public.pricing_addons
      (key, label, cost_rmb_cents, sale_sgd_cents, basis,
       applies_to, auto_rule, auto_width_over_cm)
    values
      ('extra_shipping', 'Extra shipping', null, null, 'per_unit',
       'blind', 'width_over', 200)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`delete from public.pricing_addons where key = 'extra_shipping'`.execute(
    db,
  );
  await sql`
    alter table public.pricing_addons drop constraint pricing_addons_auto_width_agrees
  `.execute(db);
  await db.schema
    .alterTable("pricing_addons")
    .dropColumn("auto_width_over_cm")
    .dropColumn("auto_rule")
    .dropColumn("applies_to")
    .execute();
  await sql`drop type pricing_addon_auto_rule`.execute(db);
  await sql`drop type pricing_addon_scope`.execute(db);
}
