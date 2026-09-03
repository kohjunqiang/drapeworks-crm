import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table public.order_shipments
      add column legacy_local_delivery_number varchar(200),
      add column legacy_overseas_freight_number varchar(200)
  `.execute(db);

  // One old goods number represented Curtains and Blinds together. Preserve
  // it as evidence, but do not claim it is either shipment's dedicated number.
  await sql`
    with ambiguous as (
      select c.order_id,
             c.local_delivery_number as legacy_local,
             c.overseas_freight_number as legacy_overseas
        from public.order_shipments c
        join public.order_shipments b
          on b.order_id = c.order_id and b.category = 'blinds'
        join public.orders o on o.id = c.order_id
       where c.category = 'curtains'
         and c.source = 'legacy_combined'
         and b.source = 'legacy_combined'
         and o.current_status in ('sent_to_vendor', 'sent_logistic', 'shipping_sg')
    )
    update public.order_shipments os
       set legacy_local_delivery_number = a.legacy_local,
           legacy_overseas_freight_number = a.legacy_overseas,
           local_delivery_number = null,
           overseas_freight_number = null
      from ambiguous a
     where os.order_id = a.order_id
       and os.category in ('curtains', 'blinds')
  `.execute(db);

  // The former Tracks row also represented Standard and S-fold together. Both
  // dedicated freight references must be confirmed by a person.
  await sql`
    with ambiguous as (
      select standard.order_id,
             standard.local_delivery_number as legacy_local,
             standard.overseas_freight_number as legacy_overseas
        from public.order_shipments standard
        join public.order_shipments sf
          on sf.order_id = standard.order_id and sf.category = 's_fold_tracks'
        join public.orders o on o.id = standard.order_id
       where standard.category = 'standard_tracks'
         and sf.source = 'legacy_combined'
         and o.current_status in ('sent_to_vendor', 'sent_logistic', 'shipping_sg')
    )
    update public.order_shipments os
       set source = 'legacy_combined',
           legacy_local_delivery_number = a.legacy_local,
           legacy_overseas_freight_number = a.legacy_overseas,
           local_delivery_number = null,
           overseas_freight_number = null
      from ambiguous a
     where os.order_id = a.order_id
       and os.category in ('standard_tracks', 's_fold_tracks')
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    update public.order_shipments
       set local_delivery_number = coalesce(
             local_delivery_number, legacy_local_delivery_number
           ),
           overseas_freight_number = coalesce(
             overseas_freight_number, legacy_overseas_freight_number
           )
     where legacy_local_delivery_number is not null
        or legacy_overseas_freight_number is not null;
    alter table public.order_shipments
      drop column legacy_overseas_freight_number,
      drop column legacy_local_delivery_number
  `.execute(db);
}
