import { STATUS_FLOW, STATUS_LABELS, statusIndex } from "@/lib/status-flow";
import type { FulfilmentStatus } from "@/lib/db/schema";

import { AddStatusNoteForm } from "./add-status-note-form";
import { RevertStatusDialog } from "./revert-status-dialog";

type Event = {
  id: string;
  status: FulfilmentStatus;
  note: string | null;
  created_at: Date | string;
};

type Props = {
  orderId: string;
  currentStatus: FulfilmentStatus;
  events: Event[];
  canAddNote: boolean;
  canRevert: boolean;
};

const SG_DATE = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

function formatDate(d: Date | string): string {
  return SG_DATE.format(new Date(d));
}

export function StatusTimeline({
  orderId,
  currentStatus,
  events,
  canAddNote,
  canRevert,
}: Props) {
  const currentIdx = statusIndex(currentStatus);

  // Group events by status (most recent first within each status).
  const eventsByStatus = new Map<FulfilmentStatus, Event[]>();
  for (const ev of [...events].sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  )) {
    const list = eventsByStatus.get(ev.status) ?? [];
    list.push(ev);
    eventsByStatus.set(ev.status, list);
  }

  const atStart = currentIdx <= 0;
  const prevLabel = atStart ? undefined : STATUS_LABELS[STATUS_FLOW[currentIdx - 1]];

  return (
    <section className="bg-white rounded-lg border border-slate-200 p-4 sm:p-6">
      <h2 className="text-base font-semibold text-slate-900 mb-4">
        Fulfilment status
      </h2>
      <ol className="relative">
        {STATUS_FLOW.map((s, i) => {
          const evs = eventsByStatus.get(s) ?? [];
          const reached = i < currentIdx;
          const current = i === currentIdx;
          const headEv = evs[0]; // most recent
          return (
            <li key={s} className="flex gap-4 pb-5 last:pb-0 relative">
              {i < STATUS_FLOW.length - 1 && (
                <div
                  className={`absolute left-3 top-6 bottom-0 w-px ${
                    reached ? "bg-emerald-300" : "bg-slate-200"
                  }`}
                />
              )}
              <div
                className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold z-10 ${
                  reached
                    ? "bg-emerald-500 text-white"
                    : current
                    ? "bg-teal-500 text-white ring-4 ring-teal-100"
                    : "bg-slate-200 text-slate-500"
                }`}
              >
                {reached ? "✓" : i + 1}
              </div>
              <div className="flex-1 min-w-0 pt-0.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-medium text-slate-900 text-sm">
                    {STATUS_LABELS[s]}
                  </div>
                  <div className="text-xs text-slate-500">
                    {headEv
                      ? formatDate(headEv.created_at)
                      : current
                      ? "In progress"
                      : "Pending"}
                  </div>
                </div>
                {evs.map((ev) => (
                  ev.note && (
                    <div
                      key={ev.id}
                      className="text-xs text-slate-600 mt-1 whitespace-pre-wrap"
                    >
                      {ev.note}
                      <span className="text-slate-400 ml-2">
                        · {formatDate(ev.created_at)}
                      </span>
                    </div>
                  )
                ))}
              </div>
            </li>
          );
        })}
      </ol>
      {canAddNote && <AddStatusNoteForm orderId={orderId} />}
      {canRevert && !atStart && prevLabel && (
        <div className="mt-3 flex justify-end">
          <RevertStatusDialog orderId={orderId} prevLabel={prevLabel} />
        </div>
      )}
    </section>
  );
}
