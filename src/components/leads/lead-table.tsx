import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ContactPriority, DueStatus, LeadDerived } from "@/lib/leads/types";
import { formatSGD } from "@/lib/money";

export type LeadRow = {
  id: string;
  lead_ref: string;
  name: string;
  mobile: string | null;
  development: string | null;
  latest_quote_cents: number | null;
  derived: LeadDerived;
};

// Keyed on the engine's ContactPriority union rather than `string`, so adding a
// band to leads/types.ts fails the build here instead of rendering an unstyled
// chip.
const PRIORITY_CLASS: Record<ContactPriority, string> = {
  "Contact Today": "bg-red-100 text-red-800",
  "Contact in 2–3 Days": "bg-amber-100 text-amber-800",
  "Contact Within 7 Days": "bg-sky-100 text-sky-800",
  "Future / Nurture": "bg-slate-100 text-slate-700",
  Closed: "bg-slate-100 text-slate-500",
};

const DUE_CLASS: Record<DueStatus, string> = {
  Overdue: "text-red-600 font-medium",
  "Due Today": "text-amber-600 font-medium",
  Upcoming: "text-slate-600",
  "Schedule Date": "text-slate-400 italic",
  Closed: "text-slate-400",
};

function PriorityBadge({ priority }: { priority: ContactPriority }) {
  return <Badge className={PRIORITY_CLASS[priority]}>{priority}</Badge>;
}

export function LeadTable({ rows }: { rows: LeadRow[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        title="No leads here"
        description="Nothing matches this tab and search. Try the All Leads tab, or clear the search."
      />
    );
  }

  return (
    <>
      {/* Desktop */}
      <div className="hidden md:block bg-white rounded-lg border border-slate-200 overflow-hidden">
        <Table>
          <TableHeader className="bg-slate-50 text-slate-600">
            <TableRow>
              <TableHead className="px-4 py-3">Priority</TableHead>
              <TableHead className="px-4 py-3">Action</TableHead>
              <TableHead className="px-4 py-3">Customer</TableHead>
              <TableHead className="px-4 py-3">Development</TableHead>
              <TableHead className="px-4 py-3">Next action</TableHead>
              <TableHead className="px-4 py-3">Due</TableHead>
              <TableHead className="px-4 py-3 text-right">Quote</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="divide-y divide-slate-100">
            {rows.map((row) => (
              <TableRow key={row.id} className="hover:bg-slate-50">
                <TableCell className="px-4 py-3">
                  <PriorityBadge priority={row.derived.contactPriority} />
                </TableCell>
                <TableCell className="px-4 py-3 text-slate-700">
                  {row.derived.actionRequired}
                </TableCell>
                <TableCell className="px-4 py-3">
                  <Link
                    href={`/leads/${row.id}`}
                    className="font-medium text-teal-600 hover:text-teal-700 hover:underline"
                  >
                    {row.name}
                  </Link>
                  {row.mobile ? (
                    <span className="block text-xs text-slate-500">
                      {row.mobile}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="px-4 py-3 text-slate-600">
                  {row.development ?? "—"}
                </TableCell>
                {/* 'Resolve Barrier' derives a blank instruction — the sheet has
                    no phrase for it either. See queue-engine.ts. */}
                <TableCell className="px-4 py-3 text-slate-600 whitespace-normal">
                  {row.derived.nextAction || "—"}
                </TableCell>
                <TableCell
                  className={`px-4 py-3 ${DUE_CLASS[row.derived.dueStatus]}`}
                >
                  {row.derived.effectiveActionDate ?? row.derived.dueStatus}
                </TableCell>
                <TableCell className="px-4 py-3 text-right font-medium text-slate-700">
                  {row.latest_quote_cents
                    ? formatSGD(row.latest_quote_cents)
                    : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobile */}
      <div className="md:hidden space-y-3">
        {rows.map((row) => (
          <Link key={row.id} href={`/leads/${row.id}`} className="block">
            <Card
              size="sm"
              className="gap-2 rounded-lg bg-white px-4 ring-slate-200 active:bg-slate-50"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold text-slate-900">
                    {row.name}
                  </div>
                  {row.mobile ? (
                    <div className="mt-0.5 text-xs text-slate-500">
                      {row.mobile}
                    </div>
                  ) : null}
                </div>
                <PriorityBadge priority={row.derived.contactPriority} />
              </div>
              <p className="text-sm text-slate-700">
                {row.derived.actionRequired}
              </p>
              <p className="text-sm text-slate-500">
                {row.derived.nextAction || "—"}
              </p>
              <div className="flex items-center justify-between gap-2">
                <span className={`text-xs ${DUE_CLASS[row.derived.dueStatus]}`}>
                  {row.derived.effectiveActionDate ?? row.derived.dueStatus}
                  {row.development ? ` · ${row.development}` : ""}
                </span>
                <span className="text-sm font-medium text-slate-900">
                  {row.latest_quote_cents
                    ? formatSGD(row.latest_quote_cents)
                    : ""}
                </span>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
