import type { DueStatus } from "./funnel-types";

export type LeadSort = "initiated" | "next" | "due";
export const parseLeadSort = (value: string | undefined): LeadSort => value === "next" || value === "due" ? value : "initiated";
const urgency: Record<DueStatus, number> = { Overdue: 0, "Due Today": 1, Upcoming: 2, "No Date": 3, Closed: 4 };

/** Sort the complete filtered set before pagination. Dates without a value stay last. */
export function sortLeadRows<T extends { next_action_date_text: string | null; first_initiated_at?: Date | string | null }>(rows: T[], sort: LeadSort, direction: "asc" | "desc", dueFor: (row: T) => DueStatus): T[] {
  const sign = direction === "asc" ? 1 : -1;
  const dateCompare = (a: T, b: T) => {
    const initiated = (row: T) => row.first_initiated_at ? new Date(row.first_initiated_at).toISOString() : null;
    const left = sort === "initiated" ? initiated(a) : a.next_action_date_text, right = sort === "initiated" ? initiated(b) : b.next_action_date_text;
    if (left === right) return 0;
    if (!left) return 1;
    if (!right) return -1;
    return left.localeCompare(right) * (sort === "due" ? 1 : sign);
  };
  // Stable sort preserves the query's newest-created/id tie-break.
  return [...rows].sort((a, b) => sort === "due"
    ? (urgency[dueFor(a)] - urgency[dueFor(b)]) * sign || dateCompare(a, b)
    : dateCompare(a, b));
}
