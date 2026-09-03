import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter function public.leads_require_recorded_deposit()
      set search_path = '';
    alter function public.orders_preserve_won_deposit()
      set search_path = '';
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter function public.leads_require_recorded_deposit()
      reset search_path;
    alter function public.orders_preserve_won_deposit()
      reset search_path;
  `.execute(db);
}
