import { sql, type Kysely } from "kysely";

// Package structure is independent from the curtain layers selected later in
// a consultation. A package is Single or Double and starts at a commercial
// tier; Day/Night are not package-header attributes.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table public.curtain_packages
      add column package_type text,
      add column base_tier text not null default 'essential'
  `.execute(db);
  await sql`
    update public.curtain_packages
      set package_type = case
        when day_group is not null and day_group <> 'none' and night_group is not null
          then 'double'
        else 'single'
      end
      where package_type is null
  `.execute(db);
  await sql`
    alter table public.curtain_packages
      alter column package_type set not null,
      alter column package_type set default 'double',
      alter column day_group drop not null,
      alter column day_group drop default,
      add constraint curtain_packages_package_type_check
        check (package_type in ('single', 'double')),
      add constraint curtain_packages_base_tier_check
        check (base_tier = 'essential')
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    update public.curtain_packages
      set day_group = 'essential',
          night_group = case when package_type = 'double' then 'essential' else null end
      where day_group is null
  `.execute(db);
  await sql`
    alter table public.curtain_packages
      alter column day_group set default 'essential',
      alter column day_group set not null,
      drop constraint curtain_packages_package_type_check,
      drop constraint curtain_packages_base_tier_check,
      drop column package_type,
      drop column base_tier
  `.execute(db);
}
