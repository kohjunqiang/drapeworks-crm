import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table public.order_shipments add column if not exists not_needed boolean not null default false`.execute(db);
}
export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`alter table public.order_shipments drop column not_needed`.execute(db);
}
