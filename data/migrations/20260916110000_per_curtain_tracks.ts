import { sql, type Kysely } from "kysely";

// Existing curtains retain their track requirements. Track choices are frozen
// at PO Ready, alongside the other consultation inputs.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable("windows")
    .addColumn("day_track_required", "boolean", (c) => c.notNull().defaultTo(true))
    .addColumn("night_track_required", "boolean", (c) => c.notNull().defaultTo(true))
    .execute();
  await sql`
    create function public.reject_locked_track_requirement_edit() returns trigger
    language plpgsql as $$
    begin
      if (new.day_track_required, new.night_track_required)
          is distinct from (old.day_track_required, old.night_track_required)
         and exists (
           select 1 from public.rooms r
           where r.id = old.room_id and public.order_is_locked(r.order_id)
         ) then
        raise exception 'Track requirements cannot change after the order is finalised.'
          using errcode = 'check_violation';
      end if;
      return new;
    end
    $$
  `.execute(db);
  await sql`
    create trigger windows_reject_locked_track_requirement_edit
    before update of day_track_required, night_track_required on public.windows
    for each row execute function public.reject_locked_track_requirement_edit()
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop trigger windows_reject_locked_track_requirement_edit on public.windows`.execute(db);
  await sql`drop function public.reject_locked_track_requirement_edit()`.execute(db);
  await db.schema.alterTable("windows")
    .dropColumn("day_track_required")
    .dropColumn("night_track_required")
    .execute();
}
