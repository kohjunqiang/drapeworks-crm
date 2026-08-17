import { sql, type Kysely } from "kysely";

// Phase 12 — blinds as a real product line.
//
// Blinds reuse the entire curtain series/types machinery rather than getting
// their own tables: pricing already lives on the series, and a series is bought
// from one vendor at one rate. A blind series holds blind types exactly as a
// curtain series holds curtain types — same photo upload, same archive
// semantics, same dialogs. `product_line` on the SERIES (not the type) is what
// keeps that single cost/sale pair meaningful; a series that could hold both
// would have no coherent rate.
//
// See docs/specs/phase-12-product-section-and-blinds.md §3.

export async function up(db: Kysely<unknown>): Promise<void> {
  // 1. Which line a series belongs to. Defaulted to 'curtain' so every existing
  //    series keeps its meaning without a backfill.
  await db.schema
    .alterTable("curtain_series")
    .addColumn("product_line", "text", (c) =>
      c.notNull().defaultTo("curtain"),
    )
    .execute();

  await sql`
    alter table public.curtain_series
      add constraint curtain_series_product_line_check
      check (product_line in ('curtain', 'blind'))
  `.execute(db);

  // 2. A window's blind. Mutually exclusive with the day/night/single curtain
  //    columns — enforced by the trigger rewritten in step 4.
  await db.schema
    .alterTable("windows")
    .addColumn("blind_type_id", "uuid", (c) => c.references("curtain_types.id"))
    .execute();

  // 3. `category` is the Day/Night SHEERNESS taxonomy. It is meaningless for a
  //    blind, so rather than seeding blinds with a lie ('Day'), the column
  //    becomes nullable and validation requires it only for curtain series.
  //    Existing rows all have a value and keep it.
  await db.schema
    .alterTable("curtain_types")
    .alterColumn("category", (c) => c.dropNotNull())
    .execute();

  // 4. The shape guard. Previously curtains-only: it required `draw` to be null
  //    on every toilet window, which would reject a blind in a toilet — a blind
  //    uses `draw` as its control side. Blinds are allowed in EVERY room type
  //    because a blind is already "one covering", the same reason the toilet
  //    variant exists; it needs no toilet-specific counterpart.
  await sql`
    create or replace function public.validate_window_shape() returns trigger
    language plpgsql as $$
    declare
      v_room_type public.room_type;
      v_is_toilet boolean;
    begin
      if new.blind_type_id is not null then
        -- A blind window carries no curtain of any kind. draw is permitted in
        -- any room: for a blind it means the chain/control side, not the pull.
        if new.day_curtain_type_id is not null
           or new.night_curtain_type_id is not null
           or new.curtain_type_id is not null then
          raise exception 'blind windows must not have any curtain type';
        end if;
        return new;
      end if;

      select type into v_room_type from public.rooms where id = new.room_id;
      v_is_toilet := v_room_type in ('Master Toilet', 'Common Toilet');
      if v_is_toilet then
        if new.draw is not null
           or new.day_curtain_type_id is not null or new.night_curtain_type_id is not null then
          raise exception 'toilet windows must not have day/night curtain or draw';
        end if;
      else
        if new.curtain_type_id is not null then
          raise exception 'non-toilet windows must not have a single curtain (use day/night)';
        end if;
      end if;
      return new;
    end
    $$
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Restore the curtains-only shape guard exactly as 20260709140000 left it.
  // Done FIRST: once blind_type_id is gone the new body would not compile.
  await sql`
    create or replace function public.validate_window_shape() returns trigger
    language plpgsql as $$
    declare
      v_room_type public.room_type;
      v_is_toilet boolean;
    begin
      select type into v_room_type from public.rooms where id = new.room_id;
      v_is_toilet := v_room_type in ('Master Toilet', 'Common Toilet');
      if v_is_toilet then
        if new.draw is not null
           or new.day_curtain_type_id is not null or new.night_curtain_type_id is not null then
          raise exception 'toilet windows must not have day/night curtain or draw';
        end if;
      else
        if new.curtain_type_id is not null then
          raise exception 'non-toilet windows must not have a single curtain (use day/night)';
        end if;
      end if;
      return new;
    end
    $$
  `.execute(db);

  await db.schema.alterTable("windows").dropColumn("blind_type_id").execute();

  await sql`
    alter table public.curtain_series
      drop constraint curtain_series_product_line_check
  `.execute(db);
  await db.schema
    .alterTable("curtain_series")
    .dropColumn("product_line")
    .execute();

  // NOTE: `curtain_types.category` is deliberately NOT restored to NOT NULL.
  // By now blind types with a null category may exist, and re-adding the
  // constraint would fail on them. Reversing that half needs a data decision
  // (delete the blind types, or backfill a category), which a migration must
  // not make silently.
}
