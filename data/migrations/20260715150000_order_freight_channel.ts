import { sql, type Kysely } from "kysely";

// Phase 9 — two per-order pricing selectors the quote reads:
//  - freight_mode: Air (rate × curtain COGS, clamped) vs Sea (flat charge).
//  - channel: Standard vs Carousell — picks the active margin floor
//    (35% vs 30%). Both default to the standard case; additive.

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`create type freight_mode as enum ('air', 'sea')`.execute(db);
  await sql`create type sales_channel as enum ('standard', 'carousell')`.execute(
    db,
  );

  await db.schema
    .alterTable("orders")
    .addColumn("freight_mode", sql`freight_mode`, (c) =>
      c.notNull().defaultTo("air"),
    )
    .addColumn("channel", sql`sales_channel`, (c) =>
      c.notNull().defaultTo("standard"),
    )
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable("orders").dropColumn("channel").execute();
  await db.schema.alterTable("orders").dropColumn("freight_mode").execute();
  await sql`drop type sales_channel`.execute(db);
  await sql`drop type freight_mode`.execute(db);
}
