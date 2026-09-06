import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable("order_quotations").dropConstraint("order_quotations_invoice_sync_state").execute();
  await db.schema.alterTable("order_quotations").addColumn("invoice_uncertain_at", "timestamptz").execute();
  await sql`alter table public.order_quotations add constraint order_quotations_invoice_sync_state check (invoice_sync_state in ('not_started','pending','created','failed','uncertain'))`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  const uncertain = await sql<{ count: string }>`select count(*) as count from public.order_quotations where invoice_sync_state = 'uncertain'`.execute(db);
  if (Number(uncertain.rows[0]?.count) > 0) throw new Error("Refusing rollback while uncertain Zoho invoice conversions require reconciliation");
  await db.schema.alterTable("order_quotations").dropConstraint("order_quotations_invoice_sync_state").execute();
  await db.schema.alterTable("order_quotations").dropColumn("invoice_uncertain_at").execute();
  await sql`alter table public.order_quotations add constraint order_quotations_invoice_sync_state check (invoice_sync_state in ('not_started','pending','created','failed'))`.execute(db);
}
