import { sql, type Kysely } from "kysely";

// One curtain height preference per curtain window, shared by the day and
// night curtains on it. The five choices are mutually exclusive; each maps to
// a signed centimetre delta that REPLACES the configured curtain height
// allowance at manufacturing time — it never stacks with it. NULL means the
// window predates the field, and those rows keep the configured allowance so
// historic dimensions are not silently re-derived.
//
// manufacture_measurements snapshots the choice at confirmation so a frozen
// row still explains where its height came from, and a later amendment or
// re-read never reinterprets it against whatever the window says today.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("windows")
    .addColumn("curtain_height_preference", "text")
    .execute();
  await sql`
    alter table public.windows
      add constraint windows_curtain_height_preference_check
      check (curtain_height_preference is null or curtain_height_preference in
        ('default', 'touch', 'sweep', 'more_sweep', 'cover_track'))
  `.execute(db);

  await db.schema
    .alterTable("manufacture_measurements")
    .addColumn("curtain_height_preference", "text")
    .execute();
  await sql`
    alter table public.manufacture_measurements
      add constraint mm_curtain_height_preference_check
      check (curtain_height_preference is null or curtain_height_preference in
        ('default', 'touch', 'sweep', 'more_sweep', 'cover_track'))
  `.execute(db);

  // A consultation input, frozen at PO Ready like the track requirements and
  // the no-installation flag: once the order is locked, only an admin
  // measurement amendment may move the height.
  await sql`
    create function public.reject_locked_curtain_height_preference_edit() returns trigger
    language plpgsql as $$
    begin
      if new.curtain_height_preference is distinct from old.curtain_height_preference
         and exists (
           select 1 from public.rooms r
           where r.id = old.room_id and public.order_is_locked(r.order_id)
         ) then
        raise exception 'Curtain height preference cannot change after the order is finalised.'
          using errcode = 'check_violation';
      end if;
      return new;
    end
    $$
  `.execute(db);
  await sql`
    create trigger windows_reject_locked_curtain_height_preference_edit
    before update of curtain_height_preference on public.windows
    for each row execute function public.reject_locked_curtain_height_preference_edit()
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop trigger windows_reject_locked_curtain_height_preference_edit on public.windows`.execute(db);
  await sql`drop function public.reject_locked_curtain_height_preference_edit()`.execute(db);
  await db.schema
    .alterTable("manufacture_measurements")
    .dropColumn("curtain_height_preference")
    .execute();
  await db.schema
    .alterTable("windows")
    .dropColumn("curtain_height_preference")
    .execute();
}
