import { type Kysely } from "kysely";

// PostgreSQL does not index foreign keys automatically. This supports the
// created_by ON DELETE SET NULL lookup when a profile is removed.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createIndex("fulfilment_arrangements_created_by_idx")
    .on("fulfilment_arrangements")
    .column("created_by")
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .dropIndex("fulfilment_arrangements_created_by_idx")
    .execute();
}
