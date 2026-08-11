"use client";

import { useFormContext, useWatch } from "react-hook-form";

import { FormSelect } from "@/components/ui/app-select";
import type { ActiveCombo } from "@/lib/db/combos";
import { formatSGD } from "@/lib/money";
import type { OrderEditInput } from "@/lib/validation/order";

export type CurtainTypeOption = {
  id: string;
  label: string;
  category: "Day" | "Night";
  photoUrl: string | null;
  costRmbCents: number | null;
  saleSgdCents: number | null;
};

const INPUT_CLS =
  "w-full px-2.5 py-2 border border-slate-200 rounded text-sm focus:outline-none focus:border-teal-500 bg-white";

type Props = {
  roomIndex: number;
  windowIndex: number;
  isToilet: boolean;
  curtainTypes: CurtainTypeOption[];
  combos: ActiveCombo[];
};

// A native <select> truncates long option labels on narrow screens and can't
// render option images, so once a curtain is chosen we show a preview row
// beneath the control: a thumbnail plus the full, wrapping label. Renders
// nothing until something is selected, so empty windows stay uncluttered.
function Preview({
  options,
  selectedId,
}: {
  options: CurtainTypeOption[];
  selectedId: string | undefined;
}) {
  const opt = selectedId ? options.find((o) => o.id === selectedId) : undefined;
  if (!opt) return null;
  return (
    <div className="mt-1.5 flex items-center gap-2 rounded border border-slate-100 bg-slate-50 p-1.5">
      <div className="w-10 h-10 flex-shrink-0 rounded border border-slate-200 bg-slate-100 overflow-hidden flex items-center justify-center text-slate-300">
        {opt.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={opt.photoUrl}
            alt={opt.label}
            className="w-full h-full object-cover"
          />
        ) : (
          // Placeholder image icon — reads as "no photo yet", not a broken box.
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z"
            />
          </svg>
        )}
      </div>
      <span className="text-xs leading-snug text-slate-600">{opt.label}</span>
    </div>
  );
}

export function WindowFields({
  roomIndex,
  windowIndex,
  isToilet,
  curtainTypes,
  combos,
}: Props) {
  const { register, control } = useFormContext<OrderEditInput>();
  const base = `rooms.${roomIndex}.windows.${windowIndex}` as const;

  const dayTypes = curtainTypes.filter((c) => c.category === "Day");
  const nightTypes = curtainTypes.filter((c) => c.category === "Night");

  const dayId = useWatch({ control, name: `${base}.day_curtain_type_id` });
  const nightId = useWatch({ control, name: `${base}.night_curtain_type_id` });
  const toiletId = useWatch({ control, name: `${base}.curtain_type_id` });
  const comboId = useWatch({ control, name: `${base}.combo_id` });
  const activeCombo = comboId
    ? combos.find((c) => c.id === comboId)
    : undefined;

  if (isToilet) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="col-span-2">
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Curtain Type
          </label>
          <FormSelect
            control={control}
            name={`${base}.curtain_type_id`}
            noneLabel="— Select —"
            options={curtainTypes.map((c) => ({
              value: c.id,
              label: `${c.label} (${c.category})`,
            }))}
          />
          <Preview options={curtainTypes} selectedId={toiletId} />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Width (cm)
          </label>
          <input
            type="number"
            className={INPUT_CLS}
            {...register(`${base}.width_cm`)}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Height (cm)
          </label>
          <input
            type="number"
            className={INPUT_CLS}
            {...register(`${base}.height_cm`)}
          />
        </div>
        <div className="col-span-2 sm:col-span-1">
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Installation Width (cm)
          </label>
          <input
            type="number"
            className={INPUT_CLS}
            {...register(`${base}.install_width_cm`)}
          />
        </div>
        <div className="col-span-2 sm:col-span-3">
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Special Notes
          </label>
          <input
            type="text"
            placeholder="e.g. corner window, no rod possible…"
            className={INPUT_CLS}
            {...register(`${base}.notes`)}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
      <div className="col-span-2 sm:col-span-3">
        <label className="block text-xs font-medium text-slate-600 mb-1">
          Day Curtain
        </label>
        <FormSelect
          control={control}
          name={`${base}.day_curtain_type_id`}
          noneLabel="— None —"
          options={dayTypes.map((c) => ({ value: c.id, label: c.label }))}
        />
        <Preview options={dayTypes} selectedId={dayId} />
      </div>
      <div className="col-span-2 sm:col-span-3">
        <label className="block text-xs font-medium text-slate-600 mb-1">
          Night Curtain
        </label>
        <FormSelect
          control={control}
          name={`${base}.night_curtain_type_id`}
          noneLabel="— None —"
          options={nightTypes.map((c) => ({ value: c.id, label: c.label }))}
        />
        <Preview options={nightTypes} selectedId={nightId} />
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
      <div className="col-span-2 sm:col-span-2">
        <label className="block text-xs font-medium text-slate-600 mb-1">
          Installation Width (cm)
        </label>
        <input
          type="number"
          className={INPUT_CLS}
          {...register(`${base}.install_width_cm`)}
        />
      </div>
      <div className="col-span-2 sm:col-span-2">
        <label className="block text-xs font-medium text-slate-600 mb-1">
          Draw
        </label>
        <FormSelect
          control={control}
          name={`${base}.draw`}
          options={[
            { value: "Double", label: "Double" },
            { value: "Single Left", label: "Single Left" },
            { value: "Single Right", label: "Single Right" },
          ]}
        />
      </div>
      <div className="col-span-2 sm:col-span-6 flex items-center gap-6 pt-0.5">
        <span className="text-xs font-medium text-slate-600">Add-ons:</span>
        <label className="flex items-center gap-1.5 text-xs text-slate-700">
          <input
            type="checkbox"
            className="rounded border-slate-300 text-teal-600 focus:ring-teal-500"
            {...register(`${base}.add_s_fold`)}
          />
          S-Fold
        </label>
        <label className="flex items-center gap-1.5 text-xs text-slate-700">
          <input
            type="checkbox"
            className="rounded border-slate-300 text-teal-600 focus:ring-teal-500"
            {...register(`${base}.add_slim_tracks`)}
          />
          Slim tracks
        </label>
      </div>
      {combos.length > 0 && (
        <div className="col-span-2 sm:col-span-3">
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Combo bundle
          </label>
          <FormSelect
            control={control}
            name={`${base}.combo_id`}
            noneLabel="— None —"
            options={combos.map((c) => ({
              value: c.id,
              label: `${c.name} — ${formatSGD(c.priceSgdCents)}`,
            }))}
          />
          {activeCombo && (
            <p className="mt-1.5 inline-flex items-center gap-1 rounded bg-amber-50 border border-amber-200 px-2 py-1 text-xs text-amber-800">
              🏷 {activeCombo.name} — {formatSGD(activeCombo.priceSgdCents)}
              /window <span className="text-amber-600">(overrides calc)</span>
            </p>
          )}
        </div>
      )}
      <div className="col-span-2 sm:col-span-4">
        <label className="block text-xs font-medium text-slate-600 mb-1">
          Special Notes
        </label>
        <input
          type="text"
          placeholder="e.g. ceiling mount, beam clearance…"
          className={INPUT_CLS}
          {...register(`${base}.notes`)}
        />
      </div>
    </div>
  );
}
