import { type Kysely } from "kysely";

// Side installation is an installation instruction, not a priced add-on. The
// add-on catalogue deliberately hides rows with no price, and the business has
// not supplied one for this flag, so it lives with the window's other site
// instructions instead of pretending to affect the quote.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("windows")
    .addColumn("side_installation", "boolean", (column) =>
      column.notNull().defaultTo(false),
    )
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("windows")
    .dropColumn("side_installation")
    .execute();
}
