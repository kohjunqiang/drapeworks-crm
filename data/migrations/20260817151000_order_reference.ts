import { sql, type Kysely } from "kysely";

// Phase 13A — the number a vendor and a delivery driver actually quote back is
// not always DW-YYYY-NNNN. display_id stays exactly as it is: trigger-assigned,
// unique, and the order's identity across the dashboard and URLs — making it
// editable would make past orders hard to find. This is a second, optional,
// human-set identifier that prints on vendor documents.
//
// A partial unique index rather than a unique constraint: many orders may have
// no reference, but no two may share one.

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("orders")
    .addColumn("order_reference", "text")
    .execute();

  await sql`
    create unique index orders_order_reference_key
      on public.orders (order_reference)
      where order_reference is not null
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop index if exists public.orders_order_reference_key`.execute(db);
  await db.schema.alterTable("orders").dropColumn("order_reference").execute();
}
