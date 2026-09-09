import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table public.order_shipments
      add column overseas_freight_assigned_at timestamptz;

    update public.order_shipments
       set overseas_freight_assigned_at = updated_at
     where nullif(btrim(overseas_freight_number), '') is not null;

    create index order_shipments_freight_assignment_idx
      on public.order_shipments (
        lower(btrim(overseas_freight_number)),
        overseas_freight_assigned_at
      )
      where nullif(btrim(overseas_freight_number), '') is not null;
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    drop index if exists public.order_shipments_freight_assignment_idx;
    alter table public.order_shipments
      drop column overseas_freight_assigned_at;
  `.execute(db);
}
