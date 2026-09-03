import { sql, type Kysely } from "kysely";

const LEAD_ID = "624fbd4f-85cc-4d39-b840-ba4d4170996e";
const CUSTOMER_ID = "e528fe1c-8c51-4157-baac-8180941a2b03";
const ORDER_ID = "9e9dac67-3e65-4773-88de-0c1b13672f59";

export async function up(db: Kysely<unknown>): Promise<void> {
  // PO 10054 already exists in the manual workflow. Keep it outside the DW
  // display sequence, but reserve the PO number so the next suggestion is
  // 10055 instead of colliding with this imported order.
  await sql`
    create temporary table isaac_import_counter_baseline
    on commit drop as
    select
      (select last_seq from public.order_year_counters where year = 2026) as order_last_seq,
      (select max(order_reference::int) from public.orders
        where order_reference ~ '^[0-9]+$') as max_po_number
  `.execute(db);

  await sql`
    do $$
    begin
      if (select order_last_seq from isaac_import_counter_baseline) is null then
        raise exception 'Order counter baseline is missing';
      end if;
      if exists (select 1 from public.orders where order_reference = '10054') then
        raise exception 'PO 10054 already exists';
      end if;
      if not exists (
        select 1 from public.leads
         where id = '624fbd4f-85cc-4d39-b840-ba4d4170996e'::uuid
           and name = 'Isaac 9235 4864'
      ) then
        raise exception 'Isaac lead not found at the expected id';
      end if;
      if exists (
        select 1 from public.orders
         where lead_id = '624fbd4f-85cc-4d39-b840-ba4d4170996e'::uuid
      ) then
        raise exception 'Isaac already has an order';
      end if;
    end
    $$
  `.execute(db);

  await sql`
    insert into public.customers (id, name, mobile, created_by)
    select ${CUSTOMER_ID}::uuid, l.name, '92354864', l.assigned_consultant_id
      from public.leads l
     where l.id = ${LEAD_ID}::uuid
  `.execute(db);
  await sql`
    update public.leads
       set customer_id = ${CUSTOMER_ID}::uuid,
           mobile = coalesce(nullif(btrim(mobile), ''), '92354864'),
           updated_at = now()
     where id = ${LEAD_ID}::uuid
  `.execute(db);

  await sql`alter table public.orders disable trigger orders_assign_display_id`.execute(db);
  await sql`
    insert into public.orders (
      id, display_id, seq_year, seq_num, customer_id, consultant_id, lead_id,
      order_reference, current_status, is_draft, general_notes
    )
    select
      ${ORDER_ID}::uuid,
      'DW-LEGACY-10054',
      2026,
      -10054,
      ${CUSTOMER_ID}::uuid,
      l.assigned_consultant_id,
      l.id,
      '10054',
      'deposit_received'::public.fulfilment_status,
      true,
      '[DATA MIGRATION] Editable shell for historical manual order PO 10054. Target status: Sent to Vendor.'
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
         (select order_last_seq from isaac_import_counter_baseline) then
        raise exception 'Isaac import changed the order counter';
      end if;
      if (
        select max(order_reference::int)
          from public.orders
         where order_reference ~ '^[0-9]+$'
      ) is distinct from greatest(
        (select max_po_number from isaac_import_counter_baseline),
        10054
      ) then
        raise exception 'Isaac import did not reserve PO 10054 correctly';
      end if;
    end
    $$
  `.execute(db);
}

export async function down(): Promise<void> {
  // Intentionally retained: once details are entered, this is business data.
}
