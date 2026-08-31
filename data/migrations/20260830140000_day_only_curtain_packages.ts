import { sql, type Kysely } from "kysely";

// A sellable package may include Day only, Night only, or both. Absence of a
// Night layer is represented by null; included Night packages still start at
// Essential and use the adjustment table for upgrades.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table public.curtain_packages
      alter column night_group drop not null,
      alter column night_group drop default
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    update public.curtain_packages
      set night_group = 'essential'
      where night_group is null
  `.execute(db);
  await sql`
    alter table public.curtain_packages
      alter column night_group set default 'essential',
      alter column night_group set not null
  `.execute(db);
}
