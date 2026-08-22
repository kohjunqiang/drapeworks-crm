import { sql, type Kysely } from "kysely";

// Phase 14 — a toilet window is a blind. The single-curtain variant modelled a
// product we no longer sell, and keeping it would force a fourth add-on scope
// existing only to describe it. 0 rows use curtain_type_id (audited
// 2026-08-21), so this strands nothing.

export async function up(db: Kysely<unknown>): Promise<void> {
  // Rewritten BEFORE the column goes: a body naming a dropped column is not
  // something to leave lying around mid-migration.
  await sql`
    create or replace function public.validate_window_shape() returns trigger
    language plpgsql as $$
    declare
      v_room_type public.room_type;
    begin
      -- A blind carries no curtain. Valid in every room, toilets included.
      if new.blind_type_id is not null then
        if new.day_curtain_type_id is not null
           or new.night_curtain_type_id is not null then
          raise exception 'blind windows must not have a curtain type';
        end if;
        return new;
      end if;

      -- No blind picked: a curtain window, or an empty one being filled in.
      -- Note draw is now permitted here: on a half-filled toilet window it is
      -- the blind's control side, and a draft must survive the round trip.
      select type into v_room_type from public.rooms where id = new.room_id;
      if v_room_type in ('Master Toilet', 'Common Toilet')
         and (new.day_curtain_type_id is not null
              or new.night_curtain_type_id is not null) then
        raise exception 'toilet windows take a blind, not a curtain';
      end if;
      return new;
    end
    $$
  `.execute(db);

  await db.schema.alterTable("windows").dropColumn("curtain_type_id").execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("windows")
    .addColumn("curtain_type_id", "uuid", (c) =>
      c.references("curtain_types.id"),
    )
    .execute();

  // Restore the body 20260817090000 left in place.
  await sql`
    create or replace function public.validate_window_shape() returns trigger
    language plpgsql as $$
    declare
      v_room_type public.room_type;
      v_is_toilet boolean;
    begin
      if new.blind_type_id is not null then
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
           or new.day_curtain_type_id is not null
           or new.night_curtain_type_id is not null then
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
