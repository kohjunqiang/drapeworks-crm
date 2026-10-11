import { sql, type Kysely } from "kysely";

// A per-window "No installation" opt-out, for curtains AND blinds. Existing
// windows keep their automatic handyman cost (default false). The flag is a
// consultation input, so it freezes at PO Ready alongside track requirements.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable("windows")
    .addColumn("no_installation", "boolean", (c) => c.notNull().defaultTo(false))
    .execute();
  await sql`
    create function public.reject_locked_no_installation_edit() returns trigger
    language plpgsql as $$
    begin
      if new.no_installation is distinct from old.no_installation
         and exists (
           select 1 from public.rooms r
           where r.id = old.room_id and public.order_is_locked(r.order_id)
         ) then
        raise exception 'No-installation flag cannot change after the order is finalised.'
          using errcode = 'check_violation';
      end if;
      return new;
    end
    $$
  `.execute(db);
  await sql`
    create trigger windows_reject_locked_no_installation_edit
    before update of no_installation on public.windows
    for each row execute function public.reject_locked_no_installation_edit()
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop trigger windows_reject_locked_no_installation_edit on public.windows`.execute(db);
  await sql`drop function public.reject_locked_no_installation_edit()`.execute(db);
  await db.schema.alterTable("windows")
    .dropColumn("no_installation")
    .execute();
}
