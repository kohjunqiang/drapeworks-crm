import { sql, type Kysely } from "kysely";

// Staleness baseline for a locked quote.
//
// `price_quoted_cents` is the FROZEN price agreed with the customer. To detect
// when the calculator has drifted from it (FX/fabric-cost/rule changes since we
// quoted), we record what the calculator produced at quote time in
// `price_calc_at_quote_cents`. The order detail/list compare the live calc
// against this baseline and surface a "pricing changed — re-quote?" prompt.
//
// Nullable: null = no baseline captured (never flagged stale). Existing orders
// are backfilled to their current quoted price, which correctly flags any order
// whose live calc no longer matches (e.g. DW-2026-0005, locked pre-track-fix).

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("orders")
    .addColumn("price_calc_at_quote_cents", "integer")
    .execute();

  await sql`
    update orders
    set price_calc_at_quote_cents = price_quoted_cents
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("orders")
    .dropColumn("price_calc_at_quote_cents")
    .execute();
}
