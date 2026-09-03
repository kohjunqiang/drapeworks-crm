import { sql, type Kysely } from "kysely";

// Admin deletion is deliberately explicit in the application: the caller must
// have the admin role and type the order number to confirm. Keep the database
// trigger as defence against direct or accidental deletes, but let that one
// application transaction opt in with a transaction-local setting.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create or replace function public.reject_locked_order_delete() returns trigger
    language plpgsql as $$
    begin
      if public.order_is_locked(old.id)
        and coalesce(current_setting('app.allow_locked_order_delete', true), '') <> 'on'
      then
        raise exception
          'order % is locked: it has been sent to the vendor and cannot be deleted outside the confirmed admin workflow',
          old.display_id;
      end if;
      return old;
    end
    $$
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    create or replace function public.reject_locked_order_delete() returns trigger
    language plpgsql as $$
    begin
      if public.order_is_locked(old.id) then
        raise exception
          'order % is locked: it has been sent to the vendor and cannot be deleted',
          old.display_id;
      end if;
      return old;
    end
    $$
  `.execute(db);
}
