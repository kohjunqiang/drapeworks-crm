import { sql, type Kysely } from "kysely";
export async function up(db: Kysely<unknown>) { await sql`alter table public.order_invoice_ledger add column source_fingerprint text`.execute(db); }
export async function down(db: Kysely<unknown>) { await sql`alter table public.order_invoice_ledger drop column source_fingerprint`.execute(db); }
