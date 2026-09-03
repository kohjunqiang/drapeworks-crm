import { sql, type Kysely } from "kysely";

const LEAD_ID = "39de703e-e1a6-47dc-b5bb-36440d4984b3";
const CUSTOMER_ID = "ef2f965c-2ed0-4a61-b5da-3a73212369b9";
const ORDER_ID = "1f69472d-2732-4d2b-93bb-eac1e46c5977";

export async function up(db: Kysely<unknown>): Promise<void> {
  // PO 10047 already exists in the manual workflow. Import it outside both
  // live number sequences, then let the user enter its details and advance it
  // through the audited CRM workflow to Sent to Vendor.
  await sql`
    create temporary table dawn_import_counter_baseline
    on commit drop as
    select
      (select last_seq from public.order_year_counters where year = 2026) as order_last_seq,
      (select max(order_reference::int) from public.orders
        where order_reference ~ '^[0-9]+$') as max_po_number
  `.execute(db);

  await sql`
    do $$
    begin
      if (select order_last_seq from dawn_import_counter_baseline) is null then
        raise exception 'Order counter baseline is missing';
      end if;
      if exists (select 1 from public.orders where order_reference = '10047') then
        raise exception 'PO 10047 already exists';
      end if;
      if not exists (
        select 1 from public.leads
         where id = '39de703e-e1a6-47dc-b5bb-36440d4984b3'::uuid
           and name = 'Dawn C. (Hello SG Deals)'
      ) then
        raise exception 'Dawn lead not found at the expected id';
      end if;
      if exists (
        select 1 from public.orders
         where lead_id = '39de703e-e1a6-47dc-b5bb-36440d4984b3'::uuid
      ) then
        raise exception 'Dawn already has an order';
      end if;
    end
    $$
  `.execute(db);

  await sql`
    insert into public.customers (id, name, mobile, created_by)
    select ${CUSTOMER_ID}::uuid, l.name, coalesce(l.mobile, ''),
           l.assigned_consultant_id
      from public.leads l
     where l.id = ${LEAD_ID}::uuid
  `.execute(db);
  await sql`
    update public.leads
       set customer_id = ${CUSTOMER_ID}::uuid,
           updated_at = now()
     where id = ${LEAD_ID}::uuid
  `.execute(db);

  await sql`alter table public.orders disable trigger orders_assign_display_id`.execute(db);
  await sql`
    insert into public.orders (
      id, display_id, seq_year, seq_num, customer_id, consultant_id, lead_id,
      order_reference, current_status, is_draft, development, general_notes
    )
    select
      ${ORDER_ID}::uuid,
      'DW-LEGACY-10047',
      2026,
      -10047,
      ${CUSTOMER_ID}::uuid,
      l.assigned_consultant_id,
      l.id,
      '10047',
      'deposit_received'::public.fulfilment_status,
      true,
      'Yishun',
      '[DATA MIGRATION] Editable shell for historical manual order PO 10047. Target status: Sent to Vendor.'
    from public.leads l
    where l.id = ${LEAD_ID}::uuid
  `.execute(db);
  await sql`set constraints all immediate`.execute(db);
  await sql`alter table public.orders enable trigger orders_assign_display_id`.execute(db);
  await sql`set constraints all deferred`.execute(db);

  await sql`
    insert into public.order_status_events (order_id, status, note, created_by)
    values (
      ${ORDER_ID}::uuid,
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
         (select order_last_seq from dawn_import_counter_baseline) then
        raise exception 'Dawn import changed the order counter';
      end if;
      if (
        select max(order_reference::int)
          from public.orders
         where order_reference ~ '^[0-9]+$'
      ) is distinct from (
        select max_po_number from dawn_import_counter_baseline
      ) then
        raise exception 'Dawn import changed the next PO-number baseline';
      end if;
    end
    $$
  `.execute(db);
}

export async function down(): Promise<void> {
  // Intentionally retained: once details are entered, this is business data.
}
