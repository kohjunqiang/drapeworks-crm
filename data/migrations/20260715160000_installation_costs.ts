import { type Kysely } from "kysely";

// Phase 9 — installation ("handyman") becomes a per-window cost by offering
// (single curtain / double curtain / blinds), replacing the flat handyman
// charge. Plus a per-order ad-hoc extra-install cost for edge cases (transport
// etc). All are costs (reduce margin). Seeded with editable placeholders.

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("pricing_assumptions")
    .addColumn("handyman_single_sgd_cents", "integer", (c) =>
      c.notNull().defaultTo(6000),
    ) // single curtain (1 track) — $60
    .addColumn("handyman_double_sgd_cents", "integer", (c) =>
      c.notNull().defaultTo(10000),
    ) // double curtain (day+night) — $100
    .addColumn("handyman_blinds_sgd_cents", "integer", (c) =>
      c.notNull().defaultTo(8000),
    ) // blinds — $80
    .execute();
  await db.schema
    .alterTable("pricing_assumptions")
    .dropColumn("handyman_sgd_cents")
    .execute();

  // Per-order ad-hoc extra install (transport etc). Rare, so defaults to 0.
  await db.schema
    .alterTable("orders")
    .addColumn("extra_install_sgd_cents", "integer", (c) =>
      c.notNull().defaultTo(0),
    )
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("orders")
    .dropColumn("extra_install_sgd_cents")
    .execute();
  await db.schema
    .alterTable("pricing_assumptions")
    .addColumn("handyman_sgd_cents", "integer", (c) =>
      c.notNull().defaultTo(10000),
    )
    .execute();
  await db.schema
    .alterTable("pricing_assumptions")
    .dropColumn("handyman_blinds_sgd_cents")
    .execute();
  await db.schema
    .alterTable("pricing_assumptions")
    .dropColumn("handyman_double_sgd_cents")
    .execute();
  await db.schema
    .alterTable("pricing_assumptions")
    .dropColumn("handyman_single_sgd_cents")
    .execute();
}
