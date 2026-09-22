import "server-only";

import { sql } from "kysely";

import { db } from "@/lib/db/kysely";

/**
 * When the order entered Completed for its current stint: the earliest
 * `completed` event after the most recent non-`completed` one. addStatusNote
 * stamps notes on a completed order as `completed` too, so the latest
 * `completed` event would restart the installer link's window on every note —
 * pinning it to the boundary keeps the window fixed, while an admin revert
 * followed by re-completion still starts a fresh one.
 */
export async function loadCompletedAt(orderId: string): Promise<Date | null> {
  const result = await sql<{ completed_at: Date | null }>`
    select min(e.created_at) as completed_at
    from public.order_status_events e
    where e.order_id = ${orderId}
      and e.status = 'completed'
      and e.created_at > coalesce(
        (
          select max(prior.created_at)
          from public.order_status_events prior
          where prior.order_id = e.order_id
            and prior.status <> 'completed'
        ),
        '-infinity'::timestamptz
      )
  `.execute(db);
  return result.rows[0]?.completed_at ?? null;
}
