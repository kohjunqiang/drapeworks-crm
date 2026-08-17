"use client";

import { useFormContext, useWatch } from "react-hook-form";

import { FormSelect } from "@/components/ui/app-select";
import {
  formatMmAsCm,
  meshDropSegments,
  meshSystemErrorMessage,
  meshTrackSegments,
  resolveMeshDrop,
  resolveMeshSystem,
  resolveMeshTrack,
  type MeshSystemBand,
  type MeshSystemSpec,
} from "@/lib/orders/mesh-system";
import type { MeshCatalogueOption } from "@/lib/pricing/order-quote";
import {
  MESH_DRAW_VALUES,
  type MeshOrderEditInput,
} from "@/lib/validation/mesh";

const INPUT_CLS =
  "w-full px-2.5 py-2 border border-slate-200 rounded text-sm focus:outline-none focus:border-teal-500 bg-white";

type Props = {
  roomIndex: number;
  panelIndex: number;
  categories: MeshCatalogueOption[];
  colours: MeshCatalogueOption[];
  systemBands: MeshSystemBand[];
  systemSpecs: MeshSystemSpec[];
};

// A catalogue select. Archived rows reach us only because this order already
// references them (loadMeshCalcConfig unions in-use ids into the active set).
// They render as the current selection but are excluded from the choosable
// options, so an old order neither blanks its select nor lets anyone newly pick
// a retired row.
function catalogueOptions(
  options: MeshCatalogueOption[],
  selectedId: string | undefined,
) {
  return options
    .filter((o) => o.selectable || o.id === selectedId)
    .map((o) => ({
      value: o.id,
      label: o.selectable ? o.name : `${o.name} (archived)`,
    }));
}

export function MeshPanelFields({
  roomIndex,
  panelIndex,
  categories,
  colours,
  systemBands,
  systemSpecs,
}: Props) {
  const { control, register } = useFormContext<MeshOrderEditInput>();
  const base = `rooms.${roomIndex}.panels.${panelIndex}` as const;

  const draw = useWatch({ control, name: `${base}.draw` });
  const categoryId = useWatch({ control, name: `${base}.category_id` });
  const colourId = useWatch({ control, name: `${base}.colour_id` });
  const widthCm = useWatch({ control, name: `${base}.width_cm` });
  const heightCm = useWatch({ control, name: `${base}.height_cm` });
  const insetH = useWatch({ control, name: `${base}.has_inset_horizontal` });
  const insetV = useWatch({ control, name: `${base}.has_inset_vertical` });
  const splitLeft = useWatch({ control, name: `${base}.split_left_cm` });
  const splitRight = useWatch({ control, name: `${base}.split_right_cm` });

  const isDouble = draw === "Double";

  // The split should sum to the total width — but a mismatch is a hint, never
  // a block. A consultant must not be stopped on site by a 1 cm discrepancy,
  // and the factory gets exactly what was measured.
  const splitSum = Number(splitLeft ?? 0) + Number(splitRight ?? 0);
  const width = Number(widthCm ?? 0);
  const splitMismatch =
    isDouble && width > 0 && splitSum > 0 && splitSum !== width;

  // Derived, never stored and never editable: width and draw decide it, and one
  // source of truth means changing the matrix changes every order.
  const height = Number(heightCm ?? 0);
  const panel = {
    widthCm: width > 0 ? width : null,
    heightCm: height > 0 ? height : null,
    draw,
    hasInsetHorizontal: !!insetH,
    hasInsetVertical: !!insetV,
  };
  const system = resolveMeshSystem(panel, systemBands);
  const track = resolveMeshTrack(panel, systemBands, systemSpecs);
  const drop = resolveMeshDrop(panel, systemBands, systemSpecs);

  // Shown beside the measurements so a consultant can sanity-check the size
  // that drives the price without doing the sum on a phone.
  const areaSqm = width > 0 && height > 0 ? (width * height) / 10_000 : null;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 sm:gap-3">
      <div className="col-span-2 sm:col-span-3">
        <label className="block text-xs font-medium text-slate-600 mb-1">
          Category
        </label>
        <FormSelect
          control={control}
          name={`${base}.category_id`}
          noneLabel="— Select —"
          options={catalogueOptions(categories, categoryId)}
        />
      </div>

      <div className="col-span-2 sm:col-span-3">
        <label className="block text-xs font-medium text-slate-600 mb-1">
          Colour
        </label>
        <FormSelect
          control={control}
          name={`${base}.colour_id`}
          noneLabel="— Select —"
          options={catalogueOptions(colours, colourId)}
        />
      </div>

      <div className="sm:col-span-2">
        <label className="block text-xs font-medium text-slate-600 mb-1">
          Width (cm)
        </label>
        <input
          type="number"
          className={INPUT_CLS}
          {...register(`${base}.width_cm`)}
        />
      </div>

      <div className="sm:col-span-2">
        <label className="block text-xs font-medium text-slate-600 mb-1">
          Height (cm)
        </label>
        <input
          type="number"
          className={INPUT_CLS}
          {...register(`${base}.height_cm`)}
        />
        {areaSqm != null && (
          <p className="mt-1 text-[11px] text-slate-400 tabular-nums">
            {width} × {height} = {areaSqm.toFixed(2)} m²
          </p>
        )}
      </div>

      {/* Sits with the measurements because it qualifies them: an inset panel
          must be made to size exactly, where a normal one has slack. Split by
          axis — only the horizontal one reaches the track. */}
      <div className="col-span-2 sm:col-span-2">
        <span className="block text-xs font-medium text-slate-600 mb-1">
          Inset
        </span>
        <div className="flex flex-col gap-1">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
              {...register(`${base}.has_inset_horizontal`)}
            />
            <span className="text-xs text-slate-600">
              Horizontal{" "}
              <span className="text-slate-400">— wall left &amp; right</span>
            </span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
              {...register(`${base}.has_inset_vertical`)}
            />
            <span className="text-xs text-slate-600">
              Vertical{" "}
              <span className="text-slate-400">— wall top &amp; bottom</span>
            </span>
          </label>
        </div>
      </div>

      <div className="sm:col-span-2">
        <label className="block text-xs font-medium text-slate-600 mb-1">
          Fixing to
        </label>
        <select
          className={INPUT_CLS}
          {...register(`${base}.has_window`, {
            setValueAs: (v) => v !== "false",
          })}
        >
          <option value="true">Window grille</option>
          <option value="false">Wall — no window</option>
        </select>
        <p className="mt-1 text-[11px] text-slate-400">
          The frame screws to the grille. Only a bare opening with no window
          goes to the wall.
        </p>
      </div>

      <div className="col-span-2 sm:col-span-2">
        <label className="block text-xs font-medium text-slate-600 mb-1">
          Draw
        </label>
        <FormSelect
          control={control}
          name={`${base}.draw`}
          noneLabel="— Select —"
          options={MESH_DRAW_VALUES.map((d) => ({ value: d, label: d }))}
        />
      </div>

      {/* Only a double draw splits into two sliding leaves. Recorded in cm
          rather than a preset ratio so any split is expressible. */}
      {isDouble && (
        <div className="col-span-2 sm:col-span-4">
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Leaf split (cm)
          </label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              placeholder="Left"
              aria-label="Left leaf width in cm"
              className={INPUT_CLS}
              {...register(`${base}.split_left_cm`)}
            />
            <span className="text-slate-400 text-sm">+</span>
            <input
              type="number"
              placeholder="Right"
              aria-label="Right leaf width in cm"
              className={INPUT_CLS}
              {...register(`${base}.split_right_cm`)}
            />
          </div>
          {splitMismatch && (
            <p className="mt-1 text-xs text-amber-700">
              Left + right is {splitSum} cm but the width is {width} cm. Saved
              as measured — check if that&rsquo;s not intended.
            </p>
          )}
        </div>
      )}

      <div className="col-span-2 sm:col-span-6">
        <label className="block text-xs font-medium text-slate-600 mb-1">
          Special Notes
        </label>
        <input
          type="text"
          placeholder="e.g. tight reveal, existing grille to remove…"
          className={INPUT_CLS}
          {...register(`${base}.notes`)}
        />
      </div>

      {/* Closes the panel: everything above is measured, this is what those
          measurements produce. Read-only and derived — width and draw decide
          it, and the matrix in /admin/product/mesh is the single source of truth. */}
      <div className="col-span-2 sm:col-span-6">
        {system.status === "resolved" && (
          <div className="flex items-baseline gap-2 rounded border border-slate-200 bg-slate-50 px-3 py-2">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
              System
            </span>
            <span className="text-sm font-semibold text-slate-900">
              {system.system}
            </span>
            <span className="text-xs text-slate-400">
              {width} cm · {isDouble ? "double" : "single"} draw
            </span>
            {track.status === "resolved" && (
              <span className="ml-auto text-sm text-slate-700">
                Track{" "}
                <span className="font-semibold text-slate-900">
                  {formatMmAsCm(track.trackMm)} cm
                </span>
                {drop.status === "resolved" && (
                  <>
                    {" · "}Drop{" "}
                    <span className="font-semibold text-slate-900">
                      {formatMmAsCm(drop.dropMm)} cm
                    </span>
                  </>
                )}
              </span>
            )}
            {track.status === "unknown-system" && (
              <span className="ml-auto text-xs text-amber-700">
                No dimensions set for {track.system} — track unknown
              </span>
            )}
            {track.status === "too-narrow" && (
              <span className="ml-auto text-xs text-red-600">
                Narrower than the hardware ({formatMmAsCm(track.minimumMm)} cm)
              </span>
            )}
          </div>
        )}

        {/* The panel laid out across the window, left to right. It sums to the
            width, so it reads as a check against the tape rather than a
            formula to be trusted. */}
        {track.status === "resolved" && (
          <p className="mt-1 px-3 text-[11px] text-slate-400">
            {meshTrackSegments(track).map((seg, i) => (
              <span key={i}>
                {i > 0 && " + "}
                <span className="tabular-nums text-slate-500">
                  {formatMmAsCm(seg.mm)}
                </span>
                <span className="text-slate-400"> ({seg.label})</span>
              </span>
            ))}
            <span className="tabular-nums"> = {width} cm</span>
          </p>
        )}

        {drop.status === "resolved" && (
          <p className="mt-0.5 px-3 text-[11px] text-slate-400">
            {meshDropSegments(drop).map((seg, i) => (
              <span key={i}>
                {i > 0 && " + "}
                <span className="tabular-nums text-slate-500">
                  {formatMmAsCm(seg.mm)}
                </span>
                <span className="text-slate-400"> ({seg.label})</span>
              </span>
            ))}
            <span className="tabular-nums"> = {height} cm</span>
          </p>
        )}

        {drop.status === "too-short" && (
          <p className="mt-0.5 px-3 text-[11px] text-red-600">
            Shorter than the top and bottom rails (
            {formatMmAsCm(drop.minimumMm)} cm)
          </p>
        )}

        {system.status === "incomplete" && (
          <div className="flex items-baseline gap-2 rounded border border-dashed border-slate-200 px-3 py-2">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
              System
            </span>
            <span className="text-sm text-slate-400">
              Enter a width and draw to see it
            </span>
          </div>
        )}

        {system.status === "not-possible" && (
          <div className="rounded border border-red-200 bg-red-50 px-3 py-2">
            <div className="flex items-baseline gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-red-500">
                System
              </span>
              <span className="text-sm font-semibold text-red-700">
                Not possible
              </span>
            </div>
            <p className="mt-0.5 text-xs text-red-600">
              {meshSystemErrorMessage(system)}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
