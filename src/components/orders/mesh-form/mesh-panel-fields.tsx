"use client";

import { useFormContext, useWatch } from "react-hook-form";

import { FormSelect } from "@/components/ui/app-select";
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
}: Props) {
  const { control, register } = useFormContext<MeshOrderEditInput>();
  const base = `rooms.${roomIndex}.panels.${panelIndex}` as const;

  const draw = useWatch({ control, name: `${base}.draw` });
  const categoryId = useWatch({ control, name: `${base}.category_id` });
  const colourId = useWatch({ control, name: `${base}.colour_id` });
  const widthCm = useWatch({ control, name: `${base}.width_cm` });
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
      </div>

      <div className="sm:col-span-2">
        <label className="block text-xs font-medium text-slate-600 mb-1">
          Recess depth (cm)
        </label>
        <input
          type="number"
          className={INPUT_CLS}
          {...register(`${base}.depth_cm`)}
        />
        <p className="mt-1 text-[11px] text-slate-400">
          How deep the reveal is — decides recess vs face mount.
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
    </div>
  );
}
