import { sql, type Kysely } from "kysely";

// An order says where it ships to.
//
// NULL means "wherever the default is" rather than "nowhere": the business has
// one address today and most orders will never touch this. Storing the default's
// id on every order instead would freeze each one against the address that
// happened to be current when it was created, so changing forwarders would only
// affect orders made afterwards — the opposite of what a default is for.
//
// No ON DELETE clause because nothing deletes a delivery address; the admin
// screen archives. The reference is what makes that true rather than hoped for.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("orders")
    .addColumn("delivery_vendor_id", "uuid", (c) =>
      c.references("delivery_vendors.id"),
    )
    .execute();

  // The sent-to-vendor lock freezes every column on orders except an allow-list
  // (see 202608181200_lock_sent_orders.ts). delivery_vendor_id joins it, for
  // the same reason order_reference is on it: it is a SHIPPING instruction, not
  // a manufacturing input. Nothing about what is cut changes when goods go to a
  // different warehouse, and the moment you most need to change it — a
  // forwarder falling over while an order is in production — is precisely when
  // the order is locked.
  //
  // Documents already generated keep the address they were generated with.
  // They are files in a bucket, and a vendor may be holding one; regenerating
  // is what supersedes them, exactly as with any other change.
  //
  // The rest of the function body is reproduced verbatim from that migration —
  // Postgres has no way to amend one line of a function.
  await sql`
    create or replace function public.reject_locked_order_edit() returns trigger
    language plpgsql as $$
    declare
      v_ignore text[] := array['current_status','updated_at','order_reference',
                               'delivery_vendor_id']::text[];
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

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    create or replace function public.reject_locked_order_edit() returns trigger
    language plpgsql as $$
    declare
      v_ignore text[] := array['current_status','updated_at','order_reference']::text[];
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

  await db.schema
    .alterTable("orders")
    .dropColumn("delivery_vendor_id")
    .execute();
}
