import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable("order_quotations")
    .addColumn("zoho_payment_id", "text", (column) => column.unique())
    .addColumn("zoho_payment_number", "text")
    .addColumn("payment_created_at", "timestamptz")
    .addColumn("payment_sync_state", "text", (column) => column.notNull().defaultTo("not_started"))
    .addColumn("payment_sync_error", "text")
    .addColumn("payment_claimed_at", "timestamptz")
    .addColumn("payment_claim_token", "uuid")
    .addColumn("payment_uncertain_at", "timestamptz")
    .execute();
  await sql`alter table public.order_quotations add constraint order_quotations_payment_sync_state check (payment_sync_state in ('not_started','pending','created','failed','uncertain'))`.execute(db);
  await sql`alter table public.order_quotations add constraint order_quotations_payment_claim_consistent check ((payment_sync_state = 'pending') = (payment_claim_token is not null and payment_claimed_at is not null))`.execute(db);
  await sql`alter table public.order_quotations add constraint order_quotations_payment_complete check (payment_sync_state <> 'created' or (zoho_payment_id is not null and payment_created_at is not null))`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  const active = await sql<{ count: string }>`select count(*) as count from public.order_quotations where payment_sync_state <> 'not_started' or zoho_payment_id is not null`.execute(db);
  if (Number(active.rows[0]?.count) > 0) throw new Error("Refusing rollback while Zoho deposit payment records exist");
  await db.schema.alterTable("order_quotations").dropConstraint("order_quotations_payment_complete").execute();
  await db.schema.alterTable("order_quotations").dropConstraint("order_quotations_payment_claim_consistent").execute();
  await db.schema.alterTable("order_quotations").dropConstraint("order_quotations_payment_sync_state").execute();
  await db.schema.alterTable("order_quotations")
    .dropColumn("payment_uncertain_at")
    .dropColumn("payment_claim_token")
    .dropColumn("payment_claimed_at")
    .dropColumn("payment_sync_error")
    .dropColumn("payment_sync_state")
    .dropColumn("payment_created_at")
    .dropColumn("zoho_payment_number")
    .dropColumn("zoho_payment_id")
    .execute();
}
