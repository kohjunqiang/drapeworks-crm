import { sql, type Kysely } from "kysely";

const TABLES = [
  "pricing_property_tiers",
  "curtain_package_prices",
  "curtain_pricing_adjustments",
  "blind_package_prices",
] as const;

export async function up(db: Kysely<unknown>): Promise<void> {
  for (const table of TABLES) {
    await sql`alter table ${sql.table(`public.${table}`)} enable row level security`.execute(db);
    await sql`
      create policy ${sql.raw(`"${table}_select_authenticated"`)}
        on ${sql.table(`public.${table}`)} for select to authenticated using (true)
    `.execute(db);
    await sql`
      create policy ${sql.raw(`"${table}_insert_admin"`)}
        on ${sql.table(`public.${table}`)} for insert to authenticated
        with check (public.is_admin())
    `.execute(db);
    await sql`
      create policy ${sql.raw(`"${table}_update_admin"`)}
        on ${sql.table(`public.${table}`)} for update to authenticated
        using (public.is_admin()) with check (public.is_admin())
    `.execute(db);
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const table of [...TABLES].reverse()) {
    await sql`drop policy if exists ${sql.raw(`"${table}_update_admin"`)} on ${sql.table(`public.${table}`)}`.execute(db);
    await sql`drop policy if exists ${sql.raw(`"${table}_insert_admin"`)} on ${sql.table(`public.${table}`)}`.execute(db);
    await sql`drop policy if exists ${sql.raw(`"${table}_select_authenticated"`)} on ${sql.table(`public.${table}`)}`.execute(db);
  }
}
