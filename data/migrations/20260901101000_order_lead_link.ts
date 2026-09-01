import { sql, type Kysely } from "kysely";

// Imported leads can already be at Attend Appointment without a corresponding
// appointment row. Keep the lead link directly on the order so those customers
// can start a consultation and still receive automatic funnel updates later.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable("orders").addColumn("lead_id", "uuid", (column) =>
    column.references("leads.id").onDelete("set null"),
  ).execute();
  await sql`update orders set lead_id = appointments.lead_id from appointments where orders.appointment_id = appointments.id and orders.lead_id is null`.execute(db);
  await db.schema.createIndex("orders_lead_id_idx").on("orders").column("lead_id").execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex("orders_lead_id_idx").execute();
  await db.schema.alterTable("orders").dropColumn("lead_id").execute();
}
