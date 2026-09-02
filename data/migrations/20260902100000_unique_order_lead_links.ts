import { sql, type Kysely } from "kysely";

// A lead or appointment represents one customer journey into one order. The UI
// filters linked leads, but only database uniqueness closes concurrent submits.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex("orders_lead_id_idx").execute();
  await sql`
    create unique index orders_lead_id_unique
      on public.orders (lead_id)
      where lead_id is not null
  `.execute(db);
  await sql`
    create unique index orders_appointment_id_unique
      on public.orders (appointment_id)
      where appointment_id is not null
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex("orders_appointment_id_unique").execute();
  await db.schema.dropIndex("orders_lead_id_unique").execute();
  await db.schema
    .createIndex("orders_lead_id_idx")
    .on("orders")
    .column("lead_id")
    .execute();
}
