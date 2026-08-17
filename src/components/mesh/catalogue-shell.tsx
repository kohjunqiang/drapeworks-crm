"use client";

import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";

// Shared chrome for the three mesh catalogue tables. Each table owns its own
// columns and dialog; this holds only what they genuinely share.

export function StatusBadge({ active }: { active: boolean }) {
  const cls = active
    ? "bg-teal-50 text-teal-700"
    : "bg-slate-100 text-slate-500";
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${cls}`}
    >
      {active ? "Active" : "Archived"}
    </span>
  );
}

export function RowActions({
  active,
  onEdit,
  onToggle,
}: {
  active: boolean;
  onEdit: () => void;
  onToggle: () => void;
}) {
  return (
    <>
      <button
        onClick={onEdit}
        className="text-xs text-slate-600 hover:text-teal-700 mr-3"
      >
        Edit
      </button>
      <button
        onClick={onToggle}
        className="text-xs text-slate-600 hover:text-red-600"
      >
        {active ? "Archive" : "Reactivate"}
      </button>
    </>
  );
}

export function CatalogueSection({
  title,
  description,
  addLabel,
  onAdd,
  isEmpty,
  emptyMessage,
  children,
}: {
  title: string;
  description: string;
  // Optional: a grid of cells edited in place has nothing to add.
  addLabel?: string;
  onAdd?: () => void;
  isEmpty: boolean;
  emptyMessage: string;
  children: ReactNode;
}) {
  return (
    <section className="mb-8">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2 mb-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <p className="text-sm text-slate-500 mt-0.5">{description}</p>
        </div>
        {onAdd && (
          <Button
            onClick={onAdd}
            className="bg-teal-600 hover:bg-teal-700 text-white shrink-0"
          >
            {addLabel}
          </Button>
        )}
      </div>

      <div className="bg-white rounded-lg border border-slate-200 overflow-x-auto">
        {isEmpty ? (
          <div className="text-center py-10 px-4 text-sm text-slate-500">
            {emptyMessage}
          </div>
        ) : (
          children
        )}
      </div>
    </section>
  );
}
