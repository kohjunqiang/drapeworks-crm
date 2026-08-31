import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    insert into public.pricing_property_tiers
      (code, label, room_set_count, position)
    values
      ('1br_2rm', '1BR Condo / 2RM BTO', 2, 10),
      ('2br_3rm', '2BR Condo / 3RM BTO', 3, 20),
      ('3br_4rm', '3BR Condo / 4RM BTO', 4, 30),
      ('4br_5rm', '4BR Condo / 5RM BTO', 5, 40),
      ('5br', '5BR', 6, 50)
  `.execute(db);

  await sql`
    insert into public.curtain_package_prices
      (property_tier_id, pls_upgrade_sgd_cents)
    select id,
      case code
        when '1br_2rm' then 20000
        when '2br_3rm' then 20000
        when '3br_4rm' then 30000
        when '4br_5rm' then 40000
        else null
      end
    from public.pricing_property_tiers
  `.execute(db);

  await sql`
    insert into public.curtain_pricing_adjustments (
      ultimate_from_essential_sgd_cents, ultimate_from_pls_sgd_cents,
      zen_default_sgd_cents, zen_4m_sgd_cents, zen_5m_sgd_cents,
      s_fold_3m_sgd_cents, s_fold_4m_sgd_cents,
      remove_day_sgd_cents, remove_essential_sgd_cents, remove_pls_sgd_cents,
      add_day_sgd_cents, add_essential_sgd_cents, add_pls_sgd_cents,
      blackout_per_m_sgd_cents, slim_single_per_m_sgd_cents,
      slim_double_per_m_sgd_cents
    ) values (
      25000, 10000,
      10000, 15000, 20000,
      30000, 40000,
      5000, 5000, 7500,
      10000, 10000, 15000,
      5000, 5000, 7000
    )
  `.execute(db);

  await sql`
    insert into public.blind_package_prices (property_tier_id, family, price_sgd_cents)
    select tier.id, prices.family::public.blind_package_family, prices.price
    from public.pricing_property_tiers tier
    join (values
      ('2br_3rm', 'venetian_roman_non_200', 108800),
      ('2br_3rm', 'roller', 78800),
      ('2br_3rm', 'combi', 98800),
      ('2br_3rm', 'roman_200', 128800),
      ('3br_4rm', 'venetian_roman_non_200', 138800),
      ('3br_4rm', 'roller', 88800),
      ('3br_4rm', 'combi', 128800),
      ('3br_4rm', 'roman_200', 168800),
      ('4br_5rm', 'venetian_roman_non_200', 168800),
      ('4br_5rm', 'roller', 118800),
      ('4br_5rm', 'combi', 148800),
      ('4br_5rm', 'roman_200', 198800),
      ('5br', 'venetian_roman_non_200', 238800),
      ('5br', 'roller', 138800),
      ('5br', 'combi', 198800),
      ('5br', 'roman_200', 288800)
    ) as prices(code, family, price) on prices.code = tier.code
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`delete from public.blind_package_prices`.execute(db);
  await sql`delete from public.curtain_pricing_adjustments`.execute(db);
  await sql`delete from public.curtain_package_prices`.execute(db);
  await sql`delete from public.pricing_property_tiers`.execute(db);
}
