import { type Kysely } from "kysely";

// Phase 9 — per-window pricing options the consultant sets on-site. Only the
// two toggles the business actually offers: S-Fold and Slim Tracks. Fullness
// (style multiplier) is fixed at 2× so it's not stored. Additive; both default
// false so existing windows are unaffected.

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("windows")
    .addColumn("add_s_fold", "boolean", (c) => c.notNull().defaultTo(false))
    .addColumn("add_slim_tracks", "boolean", (c) => c.notNull().defaultTo(false))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable("windows").dropColumn("add_slim_tracks").execute();
  await db.schema.alterTable("windows").dropColumn("add_s_fold").execute();
}
