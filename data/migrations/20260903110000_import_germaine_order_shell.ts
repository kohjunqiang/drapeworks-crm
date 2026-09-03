import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  // This is an already-numbered manual order. It must not consume either the
  // DW display sequence or the next PO number. The explicit legacy display ID
  // and negative seq_num keep it outside both live numbering domains.
  await sql`
    create temporary table germaine_import_counter_baseline
    on commit drop as
    select
      (select last_seq from public.order_year_counters where year = 2026) as order_last_seq,
      (select max(order_reference::int) from public.orders
        where order_reference ~ '^[0-9]+$') as max_po_number
  `.execute(db);
  await sql`
    do $$
    begin
      if (select order_last_seq from germaine_import_counter_baseline) is null then
        raise exception 'Order counter baseline is missing';
      end if;
      if exists (select 1 from public.orders where order_reference = '10043') then
        raise exception 'PO 10043 already exists';
      end if;
      if not exists (
        select 1 from public.leads
         where id = '65373db6-270b-4efb-821b-35e8a3333c71'::uuid
           and name = 'Germaine'
      ) then
        raise exception 'Germaine lead not found at the expected id';
      end if;
      if exists (
        select 1 from public.orders
         where lead_id = '65373db6-270b-4efb-821b-35e8a3333c71'::uuid
      ) then
        raise exception 'Germaine already has an order';
      end if;
    end
    $$
  `.execute(db);

  await sql`
    insert into public.customers (id, name, mobile, created_by)
    select '0fed8b16-7798-4ced-8e18-c4b62f6d4b55'::uuid,
           l.name, l.mobile, l.assigned_consultant_id
      from public.leads l
     where l.id = '65373db6-270b-4efb-821b-35e8a3333c71'::uuid
  `.execute(db);
  await sql`
    update public.leads
       set customer_id = '0fed8b16-7798-4ced-8e18-c4b62f6d4b55'::uuid,
           updated_at = now()
     where id = '65373db6-270b-4efb-821b-35e8a3333c71'::uuid
  `.execute(db);

  // The normal BEFORE INSERT trigger always allocates a new DW number. Disable
  // only that trigger while the table is locked by this migration transaction.
  await sql`alter table public.orders disable trigger orders_assign_display_id`.execute(db);
  await sql`
    insert into public.orders (
      id, display_id, seq_year, seq_num, customer_id, consultant_id, lead_id,
      order_reference, current_status, is_draft, general_notes
    )
    select
      'a31fd642-0fe2-4066-9762-880b0e023471'::uuid,
      'DW-LEGACY-10043',
      2026,
      -10043,
      '0fed8b16-7798-4ced-8e18-c4b62f6d4b55'::uuid,
      l.assigned_consultant_id,
      l.id,
      '10043',
      'deposit_received'::public.fulfilment_status,
      true,
      '[DATA MIGRATION] Editable shell for historical manual order PO 10043. Target status: Shipping to SG.'
    from public.leads l
    where l.id = '65373db6-270b-4efb-821b-35e8a3333c71'::uuid
  `.execute(db);
  // Flush the deferred Won/deposit integrity check before altering the table
  // again; PostgreSQL will not change trigger definitions with pending events.
  await sql`set constraints all immediate`.execute(db);
  await sql`alter table public.orders enable trigger orders_assign_display_id`.execute(db);
  await sql`set constraints all deferred`.execute(db);

  await sql`
    insert into public.order_status_events (order_id, status, note, created_by)
    values (
      'a31fd642-0fe2-4066-9762-880b0e023471'::uuid,
      'deposit_received',
      '[DATA MIGRATION] Historical order shell created for details entry',
      null
    )
  `.execute(db);

  await sql`
    do $$
    begin
      if (select last_seq from public.order_year_counters where year = 2026)
         is distinct from
         (select order_last_seq from germaine_import_counter_baseline) then
        raise exception 'Germaine import changed the order counter';
      end if;
      if (
        select max(order_reference::int)
          from public.orders
         where order_reference ~ '^[0-9]+$'
      ) is distinct from (
        select max_po_number from germaine_import_counter_baseline
      ) then
        raise exception 'Germaine import changed the next PO-number baseline';
      end if;
    end
    $$
  `.execute(db);
}

export async function down(): Promise<void> {
  // Intentionally retained: once details are entered, this is business data.
}
