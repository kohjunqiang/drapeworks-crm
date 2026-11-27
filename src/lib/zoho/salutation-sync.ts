import "server-only";

import { sql, type Transaction } from "kysely";

import { db } from "@/lib/db/kysely";
import type { DB } from "@/lib/db/schema";

import { updateZohoPrimaryContactSalutation } from "./books";

// Visible while a push is queued but unconfirmed — including a title CLEAR,
// where the desired value is null and "nothing pending" would otherwise look
// identical to "done". The quotation workspace shows this text with a retry.
export const QUEUED_MESSAGE = "Customer title update is queued for Zoho Books.";

/**
 * Park a title push INSIDE the transaction that just wrote
 * `customers.salutation`. The post-commit `syncZohoSalutation` parks again
 * under its advisory lock, but parking only there has a crash window: a
 * process death between the customer commit and the remote attempt would
 * leave the new title looking fully synced with no retry. Queuing the
 * desired value atomically with the save makes the retry marker durable —
 * the workspace shows it queued and the retry button pushes it.
 *
 * A customer with no link row has nothing to push; the update is a no-op.
 */
export async function queueZohoSalutationSync(
  trx: Transaction<DB>,
  customerId: string,
  desired: string | null,
): Promise<void> {
  await trx
    .updateTable("customer_zoho_links")
    .set({
      pending_salutation: desired,
      salutation_sync_error: QUEUED_MESSAGE,
    })
    .where("customer_id", "=", customerId)
    .execute();
}

/**
 * Push the CRM's current title to the linked Zoho contact's primary contact
 * person.
 *
 * Runs AFTER the order transaction commits — a Zoho outage must never cost a
 * CRM save, so this never throws. A per-customer advisory transaction lock
 * serializes overlapping invocations, and the desired title is re-read from
 * `customers` UNDER that lock (the CRM is authoritative), so the attempt
 * that runs last always pushes the latest committed value — a slow older
 * remote PUT can never leave Zoho behind the database. Every write-back is
 * fenced to the exact `zoho_contact_id` read under the lock, so a mid-flight
 * relink (a fresh link row pointing at a different contact) is never
 * clobbered by a stale result, and its own sync call pushes the title again.
 */
export async function syncZohoSalutation(customerId: string): Promise<void> {
  try {
    await db.transaction().execute(async (trx) => {
      // Transaction-scoped advisory lock keyed on the customer: concurrent
      // syncs queue up instead of racing their remote PUTs and write-backs.
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${customerId}, 0))`.execute(
        trx,
      );

      // Lock the LINK ROW first, in its own statement. The original customer
      // save updates this same row last (customers write, then the durable
      // queue marker), so holding it FOR UPDATE means a save that committed
      // its title but not yet its marker waits here instead of being
      // clobbered by an older attempt's park/clear. A joined FOR UPDATE read
      // would still evaluate customers from the pre-wait snapshot — the join
      // is deliberately split into two statements.
      const link = await trx
        .selectFrom("customer_zoho_links")
        .select("zoho_contact_id")
        .where("customer_id", "=", customerId)
        .forUpdate()
        .executeTakeFirst();
      if (!link) return;
      const contactId = link.zoho_contact_id;

      // Second statement, AFTER the row lock is held: READ COMMITTED gives
      // this select a fresh snapshot, so the title read here is the latest
      // committed value at the moment we finally own the row.
      const customer = await trx
        .selectFrom("customers")
        .select("salutation")
        .where("id", "=", customerId)
        .executeTakeFirst();
      const desired = customer?.salutation ?? null;
      const fencedUpdate = () =>
        trx
          .updateTable("customer_zoho_links")
          .where("customer_id", "=", customerId)
          .where("zoho_contact_id", "=", contactId);

      // Park the attempt BEFORE the remote call so the workspace shows it
      // queued — a failed push stays parked for the retry button.
      await fencedUpdate()
        .set({
          pending_salutation: desired,
          salutation_sync_error: QUEUED_MESSAGE,
        })
        .execute();

      try {
        await updateZohoPrimaryContactSalutation({
          contactId,
          salutation: desired,
        });
        await fencedUpdate()
          .set({ pending_salutation: null, salutation_sync_error: null })
          .execute();
      } catch (error) {
        await fencedUpdate()
          .set({
            salutation_sync_error:
              error instanceof Error
                ? error.message
                : "Zoho title sync failed",
          })
          .execute();
      }
    });
  } catch {
    // The CRM already holds the authoritative value; the next save or an
    // explicit retry pushes it. A double failure cannot cost the save.
  }
}

/**
 * Retry a parked title push. `syncZohoSalutation` re-reads the customer's
 * title under the serialization lock, so a retry always sends the LATEST
 * committed value and never replays a stale parked one. Returns true when
 * the link row is clean afterwards.
 */
export async function retryZohoSalutation(
  customerId: string,
): Promise<boolean> {
  const state = await db
    .selectFrom("customer_zoho_links")
    .select(["pending_salutation", "salutation_sync_error"])
    .where("customer_id", "=", customerId)
    .executeTakeFirst();
  if (
    state &&
    (state.pending_salutation !== null || state.salutation_sync_error !== null)
  ) {
    await syncZohoSalutation(customerId);
  }
  const after = await db
    .selectFrom("customer_zoho_links")
    .select(["pending_salutation", "salutation_sync_error"])
    .where("customer_id", "=", customerId)
    .executeTakeFirst();
  return (
    after?.pending_salutation == null && after?.salutation_sync_error == null
  );
}
