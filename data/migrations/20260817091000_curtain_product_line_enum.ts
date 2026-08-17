import { sql, type Kysely } from "kysely";

// Follow-up to 20260817090000, which added curtain_series.product_line as text
// + a CHECK. Every other closed value set in this schema is a real Postgres
// enum (room_type, draw_direction, pricing_calc_method, product_line...), and
// kysely-codegen turns those into string-literal unions. A text column instead
// generates `Generated<string>`, so a typo — 'blinds' for 'blind' — compiles
// happily and shows up as a silently empty catalogue at runtime. That is the
// exact bug the rest of the schema uses enums to prevent.
//
// The existing `product_line` enum can't be reused: it is ('curtain','mesh')
// and belongs to orders, where 'blind' must NOT be a legal value — blinds live
// inside a curtain order. Hence a separate, deliberately-named type.

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`create type public.curtain_product_line as enum ('curtain', 'blind')`.execute(
    db,
  );

  // The CHECK is redundant once the column's type only admits two values.
  await sql`
    alter table public.curtain_series
      drop constraint curtain_series_product_line_check
  `.execute(db);

  // The default must be dropped before the type change: Postgres cannot cast
  // the existing text default while the column type is in flight.
  await sql`
    alter table public.curtain_series
      alter column product_line drop default
  `.execute(db);

  await sql`
    alter table public.curtain_series
      alter column product_line type public.curtain_product_line
      using product_line::public.curtain_product_line
  `.execute(db);

  await sql`
    alter table public.curtain_series
      alter column product_line set default 'curtain'::public.curtain_product_line
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table public.curtain_series
      alter column product_line drop default
  `.execute(db);

  await sql`
    alter table public.curtain_series
      alter column product_line type text
      using product_line::text
  `.execute(db);

  await sql`
    alter table public.curtain_series
      alter column product_line set default 'curtain'
  `.execute(db);

  await sql`
    alter table public.curtain_series
      add constraint curtain_series_product_line_check
      check (product_line in ('curtain', 'blind'))
  `.execute(db);

  await sql`drop type public.curtain_product_line`.execute(db);
}
