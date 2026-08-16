import { type Kysely } from "kysely";

// Phase 11 — the double-draw surcharge.
//
// A double draw carries a roller and handle on EACH leaf where a single carries
// one, so it costs more to build. The extra is charged per panel, not per ft²:
// it is one additional hardware set regardless of how big the panel is — the
// same shape as the colour surcharge.
//
// It lives on the system rather than as one global figure because the hardware
// differs per system. A System 80's extra roller and handle cost more than a
// System 55's, and the matrix pushes wider panels onto heavier systems, so a
// single number would drift as the mix changes.
//
// Both nullable, meaning "no surcharge" — the same convention as the colour
// surcharges. This is the first thing that makes the track system a PRICING
// input as well as a fabrication spec, so `panelQuote` now needs the panel's
// draw to know whether the surcharge applies.

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("mesh_systems")
    .addColumn("double_cost_rmb_cents", "integer")
    .execute();
  await db.schema
    .alterTable("mesh_systems")
    .addColumn("double_sale_sgd_cents", "integer")
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("mesh_systems")
    .dropColumn("double_sale_sgd_cents")
    .execute();
  await db.schema
    .alterTable("mesh_systems")
    .dropColumn("double_cost_rmb_cents")
    .execute();
}
