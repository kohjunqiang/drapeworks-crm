"use client";

import { useEffect, useRef } from "react";
import { Truck } from "lucide-react";

import { useOrderSelection } from "@/components/orders/order-selection";
import { useFreightManager } from "@/components/orders/freight-manager";
import type { FreightSelectionItem } from "@/lib/logistics/freight-scope";

/** Leading labeled checkbox — 44px target on every surface. */
export function OrderSelectCheckbox({ order }: { order: FreightSelectionItem }) {
  const selection = useOrderSelection();
  if (!selection?.canSelect) return null;
  const checked = selection.selectedIds.has(order.id);
  return (
    <label className="inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center">
      <input
        type="checkbox"
        className="h-5 w-5 accent-teal-600"
        checked={checked}
        onChange={() => selection.toggle(order)}
        aria-label={`Select order ${order.label} for freight`}
      />
    </label>
  );
}

/** Tri-state page toggle — only ever touches this page's rows. */
export function SelectPageCheckbox() {
  const selection = useOrderSelection();
  const ref = useRef<HTMLInputElement>(null);
  const state = selection?.pageState ?? "none";
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === "some";
  }, [state]);
  if (!selection?.canSelect || !selection.pageOrders.length) return null;
  return (
    <label className="inline-flex h-11 w-11 items-center justify-center" title="Select this page">
      <input
        ref={ref}
        type="checkbox"
        className="h-5 w-5 accent-teal-600"
        checked={state === "all"}
        onChange={() => selection.togglePage()}
        aria-label="Select this page"
      />
    </label>
  );
}

/**
 * Mobile page selector — the desktop tri-state lives in the hidden table
 * header, so small screens get their own labeled 44px row above the cards.
 * Always rendered for selectable users, even with nothing selected.
 */
export function SelectPageRow() {
  const selection = useOrderSelection();
  const ref = useRef<HTMLInputElement>(null);
  const state = selection?.pageState ?? "none";
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === "some";
  }, [state]);
  if (!selection?.canSelect || !selection.pageOrders.length) return null;
  return (
    <label className="flex h-11 items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700">
      <input
        ref={ref}
        type="checkbox"
        className="h-5 w-5 accent-teal-600"
        checked={state === "all"}
        onChange={() => selection.togglePage()}
      />
      Select this page
    </label>
  );
}

/** Selection toolbar: total picked across pages + Clear + Assign freight. */
export function OrdersFreightToolbar() {
  const selection = useOrderSelection();
  const manager = useFreightManager();
  if (!selection?.canSelect || !selection.selectedCount) return null;
  const count = selection.selectedCount;
  return (
    <section
      aria-label="Order freight selection"
      className="sticky top-0 z-30 mb-4 rounded-lg border border-teal-200 bg-teal-50/95 p-3 shadow-sm backdrop-blur sm:p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <p aria-live="polite" className="mr-auto text-sm font-medium text-teal-900">
          {count} order{count === 1 ? "" : "s"} selected across pages
        </p>
        <button
          type="button"
          onClick={selection.clear}
          className="inline-flex h-11 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Clear
        </button>
        {manager && (
          <button
            type="button"
            onClick={() =>
              manager.openScopedFreight(
                selection.selected.map((item) => item.id),
                selection.clear,
              )
            }
            className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-teal-600 px-4 text-sm font-medium text-white shadow-sm hover:bg-teal-700"
          >
            <Truck className="size-4" /> Assign freight
          </button>
        )}
      </div>
      <p className="mt-2 text-xs text-teal-900/80">
        Selections are kept when you move between pages or change filters.
      </p>
    </section>
  );
}
