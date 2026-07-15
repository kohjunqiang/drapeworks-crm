import { sql, type Kysely } from "kysely";

// Drop the unused "Our Premium" assumption. It was carried over from the Excel
// but never referenced by any pricing formula — sale prices are curated per
// series, so a cost×premium markup has no role. Reversible.

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("pricing_assumptions")
    .dropColumn("premium_bps")
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("pricing_assumptions")
    .addColumn("premium_bps", "integer", (c) => c.notNull().defaultTo(11500))
    .execute();
  await sql`alter table public.pricing_assumptions alter column premium_bps drop default`.execute(
    db,
  );
}
