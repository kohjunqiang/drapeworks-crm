"use client";

import { useFormContext, useWatch } from "react-hook-form";

import {
  resolveWindowAddons,
  type AddonRule,
} from "@/lib/orders/window-addons";
import type { OrderEditInput } from "@/lib/validation/order";

type Props = {
  roomIndex: number;
  windowIndex: number;
  covering: "curtain" | "blind";
  catalogue: AddonRule[];
  /**
   * What window_addons held when this form loaded. FIXED for the life of the
   * edit — not the live form state — so clearing a retired add-on leaves it
   * listed and unticked rather than vanishing under the cursor.
   */
  persistedIds: string[];
};

export function AddonCheckboxes({
  roomIndex,
  windowIndex,
  covering,
  catalogue,
  persistedIds,
}: Props) {
  const { control, register, setValue } = useFormContext<OrderEditInput>();
  const base = `rooms.${roomIndex}.windows.${windowIndex}` as const;

  const rawWidth = useWatch({ control, name: `${base}.width_cm` });
  const selected: string[] =
    useWatch({ control, name: `${base}.addon_ids` }) ?? [];

  // A number input hands back "" while being cleared, and a string otherwise.
  const width = Number(rawWidth);
  const widthCm = Number.isFinite(width) && width > 0 ? width : null;

  const resolved = resolveWindowAddons(
    covering,
    widthCm,
    selected,
    persistedIds,
    catalogue,
  );

  function toggle(id: string, on: boolean) {
    const next = on
      ? [...new Set([...selected, id])]
      : selected.filter((x) => x !== id);
    setValue(`${base}.addon_ids`, next, { shouldDirty: true });
  }

  return (
    <fieldset className="col-span-2 flex flex-wrap items-center gap-x-6 gap-y-1 pt-0.5 sm:col-span-6">
      <legend className="sr-only">Add-ons</legend>
      <span aria-hidden="true" className="text-xs font-medium text-slate-600">
        Add-ons:
      </span>
      {resolved.map((a) => (
        <label
          key={a.id}
          className={`flex min-h-11 items-center gap-1.5 text-xs sm:min-h-0 ${
            a.locked ? "text-slate-500" : "text-slate-700"
          }`}
        >
          <input
            type="checkbox"
            checked={a.selected}
            onChange={(e) => toggle(a.id, e.target.checked)}
            // NOT `disabled`: React Hook Form drops disabled fields from
            // submitted values, which would lose the very charge the lock
            // exists to guarantee. `readOnly` is inert on a checkbox. So block
            // the mouse, block the keyboard, and tell assistive tech.
            //
            // A locked add-on's id is deliberately NOT written into form state:
            // the live quote resolves it the same way and the server re-resolves
            // on save, so syncing it here would add a second source of truth
            // that can drift from the rule.
            tabIndex={a.locked ? -1 : undefined}
            aria-disabled={a.locked || undefined}
            className={`rounded border-slate-300 text-teal-600 focus:ring-teal-500${
              a.locked ? " pointer-events-none opacity-70" : ""
            }`}
          />
          {a.label}
          {a.locked && a.autoRule === "width_over" && (
            <span className="text-[11px] text-slate-400">
              required over {a.autoWidthOverCm} cm
            </span>
          )}
        </label>
      ))}
      <label className="flex min-h-11 items-center gap-1.5 text-xs text-slate-700 sm:min-h-0">
        <input
          type="checkbox"
          className="rounded border-slate-300 text-teal-600 focus:ring-teal-500"
          {...register(`${base}.side_installation`)}
        />
        Side-installation
      </label>
      {covering === "curtain" && (
        <label className="flex min-h-11 items-center gap-1.5 text-xs text-slate-700 sm:min-h-0">
          <input
            type="checkbox"
            className="rounded border-slate-300 text-teal-600 focus:ring-teal-500"
            {...register(`${base}.overlap_tracks_attachment`)}
          />
          Overlap tracks / attachment
        </label>
      )}
    </fieldset>
  );
}
