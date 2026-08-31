import { sql, type Kysely } from "kysely";

// Self-service curtain packages. Property tiers own the included room count;
// packages reference a tier instead of copying a second count that can drift.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create type public.curtain_package_day_group
      as enum ('none', 'essential', 'signature')
  `.execute(db);

  await db.schema
    .createTable("curtain_packages")
    .addColumn("id", "uuid", (column) =>
      column.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("name", "text", (column) => column.notNull())
    .addColumn("property_tier_id", "uuid", (column) =>
      column.notNull().references("pricing_property_tiers.id").onDelete("restrict"),
    )
    .addColumn("day_group", sql`public.curtain_package_day_group`, (column) =>
      column.notNull().defaultTo("essential"),
    )
    .addColumn("night_group", "text", (column) =>
      column.notNull().defaultTo("essential"),
    )
    .addColumn("price_sgd_cents", "integer", (column) => column.notNull())
    .addColumn("is_active", "boolean", (column) =>
      column.notNull().defaultTo(true),
    )
    .addColumn("created_at", "timestamptz", (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addColumn("updated_at", "timestamptz", (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await sql`
    create unique index curtain_packages_name_unique
      on public.curtain_packages (lower(name))
  `.execute(db);
  await sql`
    alter table public.curtain_packages
      add constraint curtain_packages_night_group_essential
        check (night_group = 'essential'),
      add constraint curtain_packages_price_nonnegative
        check (price_sgd_cents >= 0)
  `.execute(db);
  await sql`
    create trigger curtain_packages_set_updated_at
      before update on public.curtain_packages
      for each row execute function public.set_updated_at()
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("curtain_packages").execute();
  await sql`drop type public.curtain_package_day_group`.execute(db);
}
