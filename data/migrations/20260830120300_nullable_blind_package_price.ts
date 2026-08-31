import type { Kysely } from "kysely";

// An unavailable package is retained as configuration history with a null
// price. This lets admins clear a cell without hard-deleting the row and keeps
// "empty means unavailable" true across save/reload.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("blind_package_prices")
    .alterColumn("price_sgd_cents", (column) => column.dropNotNull())
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Rows cleared while this migration is active prevent a safe NOT NULL
  // rollback. Leave the column nullable rather than inventing a price.
}
