import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table public.order_shipments (
      order_id uuid not null references public.orders(id) on delete cascade,
      category text not null check (category in ('curtains', 'tracks', 'blinds')),
      local_delivery_number varchar(200),
      overseas_freight_number varchar(200),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      primary key (order_id, category)
    )
  `.execute(db);
  await sql`
    create trigger order_shipments_set_updated_at
      before update on public.order_shipments
      for each row execute function public.set_updated_at()
  `.execute(db);

  // Preserve the old shared goods values. When a legacy order contains both
  // curtains and blinds, the same historical number is copied to both rows
  // because the previous UI explicitly recorded them as one shipment.
  await sql`
    insert into public.order_shipments (
      order_id, category, local_delivery_number, overseas_freight_number
    )
    select o.id, 'curtains', o.goods_local_delivery_number,
           o.goods_overseas_tracking_number
      from public.orders o
     where (
       o.current_status in (
         'sent_to_vendor', 'sent_logistic', 'shipping_sg',
         'delivered_checked', 'fulfilment', 'completed'
       )
       or o.goods_local_delivery_number is not null
       or o.goods_overseas_tracking_number is not null
     ) and (exists (
       select 1
         from public.manufacture_pos po
        where po.order_id = o.id
          and po.superseded_at is null
          and po.category in ('day', 'night')
     ) or exists (
       select 1
         from public.rooms r
         join public.windows w on w.room_id = r.id
        where r.order_id = o.id
          and (w.day_curtain_type_id is not null or w.night_curtain_type_id is not null)
     ))
  `.execute(db);
  await sql`
    insert into public.order_shipments (
      order_id, category, local_delivery_number, overseas_freight_number
    )
    select o.id, 'tracks', o.track_local_delivery_number,
           o.track_overseas_tracking_number
      from public.orders o
     where (
       o.current_status in (
         'sent_to_vendor', 'sent_logistic', 'shipping_sg',
         'delivered_checked', 'fulfilment', 'completed'
       )
       or o.track_local_delivery_number is not null
       or o.track_overseas_tracking_number is not null
     ) and (exists (
       select 1
         from public.manufacture_pos po
        where po.order_id = o.id
          and po.superseded_at is null
          and po.category in ('day', 'night')
     ) or exists (
       select 1
         from public.rooms r
         join public.windows w on w.room_id = r.id
        where r.order_id = o.id
          and (w.day_curtain_type_id is not null or w.night_curtain_type_id is not null)
     ))
  `.execute(db);
  await sql`
    insert into public.order_shipments (
      order_id, category, local_delivery_number, overseas_freight_number
    )
    select o.id, 'blinds', o.goods_local_delivery_number,
           o.goods_overseas_tracking_number
      from public.orders o
     where (
       o.current_status in (
         'sent_to_vendor', 'sent_logistic', 'shipping_sg',
         'delivered_checked', 'fulfilment', 'completed'
       )
       or o.goods_local_delivery_number is not null
       or o.goods_overseas_tracking_number is not null
     ) and (exists (
       select 1
         from public.manufacture_pos po
        where po.order_id = o.id
          and po.superseded_at is null
          and po.category = 'blind'
     ) or exists (
       select 1
         from public.rooms r
         join public.windows w on w.room_id = r.id
        where r.order_id = o.id
          and w.blind_type_id is not null
     ))
  `.execute(db);

  await sql`alter table public.order_shipments enable row level security`.execute(db);
  await sql`
    create policy "order_shipments_select_authenticated"
      on public.order_shipments for select to authenticated using (true)
  `.execute(db);
  // Shipment categories are derived from the generated PO set and must only
  // be written through the transactional server actions. Do not expose direct
  // Data API writes, which could invent a category that the order does not have.
  await sql`
    revoke insert, update, delete on public.order_shipments
      from anon, authenticated
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("order_shipments").execute();
}
