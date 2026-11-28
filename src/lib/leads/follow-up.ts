import type { Kysely } from "kysely";
import { sql } from "kysely";

import type { DB } from "@/lib/db/schema";
import type { FunnelStage } from "@/lib/leads/funnel-types";
import { diffSgDays, toSgDate, type SgDate } from "@/lib/leads/sg-date";

/**
 * Latest attended consultation per lead: `max(scheduled_at)` where the
 * appointment was completed. A later scheduled/no-show/cancelled appointment
 * must not mask the attended one — hence the status filter, and scheduled_at
 * rather than updated_at. Bounded to the fetched leads, never per-row.
 */
export async function loadLastCompletedAppointments(
  db: Kysely<DB>,
  leadIds: string[],
): Promise<Map<string, Date>> {
  const map = new Map<string, Date>();
  if (!leadIds.length) return map;
  const rows = await db
    .selectFrom("appointments")
    .select(["lead_id", sql<Date>`max(scheduled_at)`.as("last_at")])
    .where("lead_id", "in", leadIds)
    .where("status", "=", "completed")
    .groupBy("lead_id")
    .execute();
  for (const row of rows) {
    if (row.last_at) map.set(row.lead_id, row.last_at);
  }
  return map;
}

/**
 * Numbered follow-up nudge counted in Singapore calendar days from the last
 * attended appointment: 1–3 → 1, 4–6 → 2, 7–14 → 3, 15–29 → 4, 30+ → 5. The
 * band only moves at the next threshold, and the label is suppressed entirely
 * for day 0, future-dated appointments, missing attendance, and leads that
 * are Won, Lost or archived (Not Qualified stays labelled, matching the All
 * Leads queue's own exclusion rules).
 */
export function leadFollowUpLabel(args: {
  funnelStage: FunnelStage | string;
  isArchived?: boolean | null;
  lastCompletedAt: Date | string | null;
  today: SgDate;
}): string | null {
  if (args.isArchived) return null;
  if (args.funnelStage === "Won" || args.funnelStage === "Lost") return null;
  if (!args.lastCompletedAt) return null;
  const days = diffSgDays(toSgDate(new Date(args.lastCompletedAt)), args.today);
  if (days <= 0) return null;
  const n = days <= 3 ? 1 : days <= 6 ? 2 : days <= 14 ? 3 : days <= 29 ? 4 : 5;
  return `Follow-up ${n} due`;
}
