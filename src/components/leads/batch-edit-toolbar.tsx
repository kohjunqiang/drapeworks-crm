"use client";

import { useState } from "react";

import { useBatchEdit } from "@/components/leads/batch-edit-context";
import { BATCH_FIELD_LABELS, type BatchEditableField } from "@/lib/leads/batch-draft";

export function LeadBatchToolbar() {
  const ctx = useBatchEdit();
  const [reviewOpen, setReviewOpen] = useState(false);
  if (!ctx) return null;
  const { selectedCount, changedCount, saving, saveErrors, order, entries } = ctx;
  if (!selectedCount && !saveErrors.length) return null;

  const namedError = (leadId: string) => entries[leadId]?.snapshot.name || "Lead";

  return <section aria-label="Batch lead editing" className="sticky top-0 z-30 mb-4 rounded-xl border border-teal-200 bg-teal-50/95 p-3 shadow-sm backdrop-blur sm:p-4">
    <div className="flex flex-wrap items-center gap-2">
      <p className="mr-auto text-sm font-medium text-teal-900">
        {selectedCount} selected across pages · {changedCount} with changes
      </p>
      <button type="button" onClick={() => setReviewOpen(open => !open)} aria-expanded={reviewOpen}
        className="inline-flex h-11 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50">
        Review selected
      </button>
      <button type="button" onClick={ctx.saveAll} disabled={saving || !changedCount}
        className="inline-flex h-11 items-center justify-center rounded-lg bg-teal-600 px-4 text-sm font-medium text-white shadow-sm hover:bg-teal-700 disabled:opacity-50">
        {saving ? "Saving…" : `Save ${changedCount || ""} change${changedCount === 1 ? "" : "s"}`}
      </button>
      <button type="button" onClick={ctx.cancelAll} disabled={saving}
        className="inline-flex h-11 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
        Cancel
      </button>
    </div>
    <p className="mt-2 text-xs text-teal-900/80">
      Lead status, Action required, Due status and Priority are calculated — they show the last saved values while you edit and update after you save. Selections and edits are kept when you move between pages.
    </p>
    {saveErrors.length > 0 && <ul className="mt-3 max-h-48 space-y-1.5 overflow-y-auto" aria-label="Batch save errors">
      {saveErrors.map((error, index) => <li key={`${error.leadId}-${error.field ?? "lead"}-${index}`} className="text-sm">
        {error.leadId && entries[error.leadId]
          ? <button type="button" onClick={() => ctx.jumpTo(error.leadId, error.field)} className="inline-flex min-h-11 items-center py-1 font-medium text-red-700 underline decoration-red-300 underline-offset-2 hover:text-red-800">
              {namedError(error.leadId)}{error.field ? ` · ${BATCH_FIELD_LABELS[error.field as BatchEditableField] ?? error.field}` : ""}
            </button>
          : <span className="font-medium text-red-700">Batch</span>}
        <span className="text-red-700"> — {error.message}</span>
      </li>)}
    </ul>}
    {reviewOpen && <ul className="mt-3 max-h-64 divide-y divide-teal-100 overflow-y-auto rounded-lg border border-teal-200 bg-white" aria-label="Selected leads">
      {order.map(id => {
        const entry = entries[id];
        if (!entry) return null;
        const changed = ctx.changedFor(id);
        return <li key={id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
          <button type="button" onClick={() => ctx.jumpTo(id)} className="inline-flex min-h-11 min-w-0 items-center truncate font-medium text-teal-700 hover:underline">
            {entry.snapshot.name || "Loading…"}
          </button>
          <span className="min-w-0 flex-1 truncate text-xs text-slate-500">
            {entry.loading ? "Loading…" : changed.length ? changed.map(field => BATCH_FIELD_LABELS[field]).join(", ") : "No changes"}
          </span>
          {changed.length > 0 && <button type="button" disabled={saving} onClick={() => ctx.discardLeadEdits(id)} className="inline-flex h-11 items-center rounded px-3 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50">
            Discard edits
          </button>}
        </li>;
      })}
    </ul>}
  </section>;
}
