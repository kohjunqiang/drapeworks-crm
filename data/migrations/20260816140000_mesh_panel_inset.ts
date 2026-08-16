import { type Kysely } from "kysely";

// Phase 11 — flag a panel whose opening is inset into the wall.
//
// When the window is set into the wall there is wall on the sides of it, so the
// panel has to fit within that space. It may match the measured size exactly
// but must never exceed it, or it physically will not go in.
//
// Deliberately a boolean and not a set of measurements. The lengths are not
// acted on by anyone: what changes is that the panel must be made to size with
// no overhang, and that is fully expressed by "there is an inset". Asking a
// consultant for four numbers nobody reads would be the same mistake `depth_cm`
// was (see 20260816100000).
//
// Defaults to false — an unticked box means no inset, and unlike `has_window`
// this is the exception rather than the norm. Does not affect price or install.

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("mesh_panels")
    .addColumn("has_inset", "boolean", (c) => c.notNull().defaultTo(false))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable("mesh_panels").dropColumn("has_inset").execute();
}
