import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table public.migration_20260902_advanced_draft_orders (
      order_id uuid primary key references public.orders(id) on delete cascade
    )
  `.execute(db);
  await sql`
    revoke all on public.migration_20260902_advanced_draft_orders
      from anon, authenticated
  `.execute(db);
  await sql`
    alter table public.migration_20260902_advanced_draft_orders
      enable row level security
  `.execute(db);
  await sql`
    insert into public.migration_20260902_advanced_draft_orders (order_id)
    select id
      from public.orders
     where is_draft = true
       and current_status <> 'order_recorded'
  `.execute(db);
  await sql`alter table public.orders disable trigger orders_reject_locked_edit`.execute(db);
  await sql`
    update public.orders o
       set is_draft = false,
           updated_at = now()
      from public.migration_20260902_advanced_draft_orders repaired
     where o.id = repaired.order_id
  `.execute(db);
  await sql`alter table public.orders enable trigger orders_reject_locked_edit`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`alter table public.orders disable trigger orders_reject_locked_edit`.execute(db);
  await sql`
    update public.orders o
       set is_draft = true,
           updated_at = now()
      from public.migration_20260902_advanced_draft_orders repaired
     where o.id = repaired.order_id
  `.execute(db);
  await sql`alter table public.orders enable trigger orders_reject_locked_edit`.execute(db);
  await db.schema
    .dropTable("migration_20260902_advanced_draft_orders")
    .execute();
}
