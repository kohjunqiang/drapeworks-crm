import { sql, type Kysely } from "kysely";

// Zoho Books treats an estimate's expiry_date as optional and returns "" when
// it is blank, so requiring one made a valid Zoho quotation unimportable. The
// expiry was never a business rule — only the schema demanded it — so the
// column and its ordering check both relax to allow a null expiry.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("order_quotations")
    .dropConstraint("order_quotations_dates_ordered")
    .execute();
  await sql`alter table public.order_quotations alter column expiry_date drop not null`.execute(db);
  await db.schema
    .alterTable("order_quotations")
    .addCheckConstraint("order_quotations_dates_ordered", sql`expiry_date is null or expiry_date >= issue_date`)
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("order_quotations")
    .dropConstraint("order_quotations_dates_ordered")
    .execute();
  // Postgres treats a null expiry as passing this check, so restoring the
  // original constraint is always safe even with null rows present.
  await db.schema
    .alterTable("order_quotations")
    .addCheckConstraint("order_quotations_dates_ordered", sql`expiry_date >= issue_date`)
    .execute();
  // Re-adding NOT NULL fails once any quotation stores a null expiry. Restore
  // it only while no row relies on the relaxed column; otherwise leave the
  // column nullable — removing those nulls is a data decision a migration
  // must not make silently.
  const nulls = await sql<{ count: string }>`select count(*) as count from public.order_quotations where expiry_date is null`.execute(db);
  if (Number(nulls.rows[0]?.count ?? "0") === 0) {
    await sql`alter table public.order_quotations alter column expiry_date set not null`.execute(db);
  }
}
