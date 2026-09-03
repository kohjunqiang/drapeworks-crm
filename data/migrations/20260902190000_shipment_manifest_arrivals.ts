import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table public.order_shipments
      drop constraint order_shipments_category_check;
    update public.order_shipments set category = 'standard_tracks'
      where category = 'tracks';
    alter table public.order_shipments
      add constraint order_shipments_category_check check (
        category in (
          'curtains', 'blinds', 'mesh', 'standard_tracks',
          's_fold_tracks', 'overlap_tracks_attachment'
        )
      ),
      add column arrived_checked_at timestamptz,
      add column arrived_checked_by uuid references public.profiles(id),
      add column arrival_note varchar(2000),
      add column source text not null default 'derived' check (
        source in ('derived', 'legacy_imported', 'legacy_combined')
      );
    update public.order_shipments set source = 'legacy_imported';
  `.execute(db);

  // Mesh was intentionally outside the first shipment migration. It uses the
  // old goods fields, so its one historical row can be imported without
  // inventing a second consignment.
  await sql`
    insert into public.order_shipments (
      order_id, category, local_delivery_number, overseas_freight_number, source
    )
    select o.id, 'mesh', o.goods_local_delivery_number,
           o.goods_overseas_tracking_number, 'legacy_imported'
      from public.orders o
     where o.product_line = 'mesh'
       and exists (
         select 1 from public.rooms r
         join public.mesh_panels mp on mp.room_id = r.id
         where r.order_id = o.id
       )
       and (
         o.current_status in (
           'sent_to_vendor', 'sent_logistic', 'shipping_sg',
           'delivered_checked', 'fulfilment', 'completed'
         )
         or o.goods_local_delivery_number is not null
         or o.goods_overseas_tracking_number is not null
       )
    on conflict (order_id, category) do nothing
  `.execute(db);

  // A S-fold-only order's former combined track value is unambiguous: it
  // belongs to the S-fold track shipment. Move it before removing the obsolete
  // standard row. Mixed standard/S-fold orders remain deliberately unresolved.
  await sql`
    insert into public.order_shipments (
      order_id, category, local_delivery_number, overseas_freight_number, source
    )
    select distinct o.id, 's_fold_tracks', null,
           case when not exists (
             select 1 from public.rooms r2
             join public.windows w2 on w2.room_id = r2.id
             where r2.order_id = o.id
               and (w2.day_curtain_type_id is not null or w2.night_curtain_type_id is not null)
               and not exists (
                 select 1 from public.window_addons wa2
                 join public.pricing_addons pa2 on pa2.id = wa2.addon_id
                 where wa2.window_id = w2.id and pa2.key = 's_fold'
               )
           ) then legacy.overseas_freight_number else null end,
           case when exists (
             select 1 from public.rooms r2
             join public.windows w2 on w2.room_id = r2.id
             where r2.order_id = o.id
               and (w2.day_curtain_type_id is not null or w2.night_curtain_type_id is not null)
               and not exists (
                 select 1 from public.window_addons wa2
                 join public.pricing_addons pa2 on pa2.id = wa2.addon_id
                 where wa2.window_id = w2.id and pa2.key = 's_fold'
               )
           ) then 'legacy_combined' else 'legacy_imported' end
      from public.orders o
      join public.rooms r on r.order_id = o.id
      join public.windows w on w.room_id = r.id
      join public.window_addons wa on wa.window_id = w.id
      join public.pricing_addons pa on pa.id = wa.addon_id and pa.key = 's_fold'
      left join public.order_shipments legacy
        on legacy.order_id = o.id and legacy.category = 'standard_tracks'
     where (w.day_curtain_type_id is not null or w.night_curtain_type_id is not null)
       and o.current_status in (
         'sent_to_vendor', 'sent_logistic', 'shipping_sg',
         'delivered_checked', 'fulfilment', 'completed'
       )
    on conflict (order_id, category) do nothing
  `.execute(db);
  await sql`
    delete from public.order_shipments os
     where os.category = 'standard_tracks'
       and exists (
         select 1 from public.order_shipments sf
         where sf.order_id = os.order_id and sf.category = 's_fold_tracks'
       )
       and not exists (
         select 1 from public.rooms r
         join public.windows w on w.room_id = r.id
         where r.order_id = os.order_id
           and (w.day_curtain_type_id is not null or w.night_curtain_type_id is not null)
           and not exists (
             select 1 from public.window_addons wa
             join public.pricing_addons pa on pa.id = wa.addon_id
             where wa.window_id = w.id and pa.key = 's_fold'
           )
       )
  `.execute(db);

  await sql`
    insert into public.order_shipments (
      order_id, category, source
    )
    select distinct o.id, 'overlap_tracks_attachment', 'legacy_imported'
      from public.orders o
      join public.rooms r on r.order_id = o.id
      join public.windows w on w.room_id = r.id
     where w.overlap_tracks_attachment
       and (w.day_curtain_type_id is not null or w.night_curtain_type_id is not null)
       and o.current_status in (
         'sent_to_vendor', 'sent_logistic', 'shipping_sg',
         'delivered_checked', 'fulfilment', 'completed'
       )
    on conflict (order_id, category) do nothing
  `.execute(db);

  // The old goods reference was intentionally shared. Preserve that evidence
  // without claiming it was captured separately for curtains and blinds.
  await sql`
    update public.order_shipments os set source = 'legacy_combined'
     where os.category in ('curtains', 'blinds')
       and exists (
         select 1 from public.order_shipments sibling
         where sibling.order_id = os.order_id
           and sibling.category in ('curtains', 'blinds')
           and sibling.category <> os.category
           and sibling.local_delivery_number is not distinct from os.local_delivery_number
           and sibling.overseas_freight_number is not distinct from os.overseas_freight_number
       )
  `.execute(db);

  // Orders which already passed delivery are historical facts. Grandfather
  // their then-known manifest from the status event rather than making them
  // operationally incomplete under a rule introduced later.
  await sql`
    update public.order_shipments os
       set arrived_checked_at = (
             select e.created_at from public.order_status_events e
              where e.order_id = os.order_id and e.status = 'delivered_checked'
              order by e.created_at asc limit 1
           ),
           arrived_checked_by = (
             select e.created_by from public.order_status_events e
              where e.order_id = os.order_id and e.status = 'delivered_checked'
              order by e.created_at asc limit 1
           )
     where exists (
       select 1 from public.orders o
        where o.id = os.order_id
          and o.current_status in ('delivered_checked', 'fulfilment', 'completed')
     )
       and exists (
         select 1 from public.order_status_events e
          where e.order_id = os.order_id and e.status = 'delivered_checked'
       )
  `.execute(db);

  await sql`
    create table public.order_shipment_events (
      id uuid primary key default gen_random_uuid(),
      order_id uuid not null references public.orders(id) on delete cascade,
      category text not null,
      event_type text not null check (
        event_type in ('arrival_recorded', 'arrival_reopened')
      ),
      note varchar(2000),
      created_by uuid references public.profiles(id),
      created_at timestamptz not null default now(),
      foreign key (order_id, category)
        references public.order_shipments(order_id, category) on delete cascade
    );
    create index order_shipment_events_order_created_idx
      on public.order_shipment_events (order_id, created_at desc);
    alter table public.order_shipment_events enable row level security;
    create policy "order_shipment_events_select_authenticated"
      on public.order_shipment_events for select to authenticated using (true);
    revoke insert, update, delete on public.order_shipment_events
      from anon, authenticated;
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("order_shipment_events").execute();
  await sql`
    alter table public.order_shipments
      drop constraint order_shipments_category_check;
    insert into public.order_shipments (
      order_id, category, local_delivery_number, overseas_freight_number,
      created_at, updated_at, source
    )
    select sf.order_id, 'standard_tracks', sf.local_delivery_number,
           sf.overseas_freight_number, sf.created_at, sf.updated_at, sf.source
      from public.order_shipments sf
     where sf.category = 's_fold_tracks'
       and not exists (
         select 1 from public.order_shipments standard
          where standard.order_id = sf.order_id
            and standard.category = 'standard_tracks'
       );
    delete from public.order_shipments
      where category in ('mesh', 's_fold_tracks', 'overlap_tracks_attachment');
    update public.order_shipments set category = 'tracks'
      where category = 'standard_tracks';
    alter table public.order_shipments
      drop column source,
      drop column arrival_note,
      drop column arrived_checked_by,
      drop column arrived_checked_at,
      add constraint order_shipments_category_check check (
        category in ('curtains', 'tracks', 'blinds')
      );
  `.execute(db);
}
