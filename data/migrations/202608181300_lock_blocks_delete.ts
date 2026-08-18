import { sql, type Kysely } from "kysely";

// Phase 13B follow-up — the lock has to cover DELETE too.
//
// 202608181200 froze an order's columns with a BEFORE UPDATE trigger. Delete
// was left to the action-layer guard in deleteOrder(), which is the one verb
// where that is not good enough: a `delete from orders` cascades away the
// rooms, windows, mesh panels, status events and manufacture_measurements of an
// order whose goods are already being cut, and there is no undo.
//
// TWO CORRECTIONS TO THE 202608181200 HEADER, recorded here because an
// already-executed migration is a historical record and must not be edited:
//
//  1. That header describes the blanket RLS predicate on rooms, windows and
//     mesh_panels as the enforcement, and the trigger as a "bonus" that also
//     binds the owner connection. That is backwards. The application connects
//     as `postgres`, which owns these tables and carries rolbypassrls, and
//     `authenticated` holds no grants on them at all — so every RLS policy in
//     this repo, old and new, is inert for the running app. Verified: a rooms
//     UPDATE on a locked order succeeds on the app's own connection despite the
//     policy forbidding it. The trigger is the ONLY layer that binds today.
//  2. Consequently the lock is asymmetric. Order-header columns are genuinely
//     frozen in the database; room labels and window dimensions — the actual
//     manufacturing inputs — are protected only by isLocked() in updateOrder
//     and updateMeshOrder. Closing that gap needs the app to stop connecting as
//     the table owner, which is a project rather than a migration.

export async function up(db: Kysely<unknown>): Promise<void> {
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

  await sql`
    create trigger orders_reject_locked_delete
      before delete on public.orders
      for each row execute function public.reject_locked_order_delete()
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop trigger if exists orders_reject_locked_delete on public.orders`.execute(
    db,
  );
  await sql`drop function if exists public.reject_locked_order_delete()`.execute(
    db,
  );
}
