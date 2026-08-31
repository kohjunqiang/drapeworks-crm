import { sql, type Kysely } from "kysely";

// Uses the project's Kysely migration runner, not Supabase SQL migrations.
// Existing orders retain their automatic reference; existing RLS is unchanged.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable("orders")
    .addColumn("po_customer_reference", "varchar(500)")
    .execute();
  await updateLock(db, true);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await updateLock(db, false);
  await db.schema.alterTable("orders").dropColumn("po_customer_reference").execute();
}

async function updateLock(db: Kysely<unknown>, allowReference: boolean) {
  const ignore = allowReference
    ? "array['current_status','updated_at','order_reference','delivery_vendor_id','po_customer_reference']::text[]"
    : "array['current_status','updated_at','order_reference','delivery_vendor_id']::text[]";
  await sql`
    create or replace function public.reject_locked_order_edit() returns trigger
    language plpgsql as $$
    declare
      v_ignore text[] := ${sql.raw(ignore)};
      v_generated text[];
    begin
      if not public.order_is_locked(old.id) then
        return new;
      end if;
      select coalesce(array_agg(a.attname::text), '{}') into v_generated
        from pg_attribute a
       where a.attrelid = 'public.orders'::regclass
         and a.attnum > 0 and not a.attisdropped and a.attgenerated <> '';
      v_ignore := v_ignore || v_generated;
      if (to_jsonb(new) - v_ignore) is distinct from (to_jsonb(old) - v_ignore) then
        raise exception
          'order % is locked: it has been sent to the vendor. Amend the manufacturing measurements instead.',
          old.display_id
          using errcode = 'check_violation';
      end if;
      return new;
    end
    $$
  `.execute(db);
}
