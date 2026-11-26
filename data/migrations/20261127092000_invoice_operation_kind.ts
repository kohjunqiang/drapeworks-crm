import { sql, type Kysely } from "kysely";
export async function up(db: Kysely<unknown>) { await sql`alter table public.order_invoice_ledger add column claim_kind text check(claim_kind in ('create','update','payment','legacy')); update public.order_invoice_ledger set claim_kind='legacy' where claim_token is not null`.execute(db); }
export async function down(db: Kysely<unknown>) { await sql`alter table public.order_invoice_ledger drop column claim_kind`.execute(db); }
