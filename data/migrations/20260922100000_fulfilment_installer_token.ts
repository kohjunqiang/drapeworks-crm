import { sql, type Kysely } from "kysely";

// The installer has no CRM login, so a booking carries a random token that
// opens a public read-only page with the schedule, measurements and room
// photos. A stored token — not a signed URL — so it can be revoked: Reset
// link rotates it, and re-booking after a cancellation mints a fresh one.
// The default backfills a token for every existing booking; the unique
// constraint guarantees the public lookup matches at most one arrangement.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("fulfilment_arrangements")
    .addColumn("installer_token", "uuid", (column) =>
      column.notNull().defaultTo(sql`gen_random_uuid()`),
    )
    .execute();

  await db.schema
    .alterTable("fulfilment_arrangements")
    .addUniqueConstraint("fulfilment_arrangements_installer_token_key", [
      "installer_token",
    ])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("fulfilment_arrangements")
    .dropConstraint("fulfilment_arrangements_installer_token_key")
    .execute();

  await db.schema
    .alterTable("fulfilment_arrangements")
    .dropColumn("installer_token")
    .execute();
}
