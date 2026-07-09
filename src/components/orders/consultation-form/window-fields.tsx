"use client";

import { useFormContext, useWatch } from "react-hook-form";

import type { OrderEditInput } from "@/lib/validation/order";

export type CurtainTypeOption = {
  id: string;
  label: string;
  category: "Day" | "Night";
  photoUrl: string | null;
};

const INPUT_CLS =
  "w-full px-2.5 py-1.5 border border-slate-200 rounded text-sm focus:outline-none focus:border-teal-500 bg-white";

type Props = {
  roomIndex: number;
  windowIndex: number;
  isToilet: boolean;
  curtainTypes: CurtainTypeOption[];
};

// A native <select> can't render option images, so we show a small preview
// thumbnail beside the control driven by the currently-selected id.
function Thumb({
  options,
  selectedId,
}: {
  options: CurtainTypeOption[];
  selectedId: string | undefined;
}) {
  const opt = selectedId ? options.find((o) => o.id === selectedId) : undefined;
  return (
    <div className="w-9 h-9 flex-shrink-0 rounded border border-slate-200 bg-slate-100 overflow-hidden flex items-center justify-center">
      {opt?.photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={opt.photoUrl}
          alt={opt.label}
          className="w-full h-full object-cover"
        />
      ) : null}
    </div>
  );
}

export function WindowFields({
  roomIndex,
  windowIndex,
  isToilet,
  curtainTypes,
}: Props) {
  const { register, control } = useFormContext<OrderEditInput>();
  const base = `rooms.${roomIndex}.windows.${windowIndex}` as const;

  const dayTypes = curtainTypes.filter((c) => c.category === "Day");
  const nightTypes = curtainTypes.filter((c) => c.category === "Night");

  const dayId = useWatch({ control, name: `${base}.day_curtain_type_id` });
  const nightId = useWatch({ control, name: `${base}.night_curtain_type_id` });
  const toiletId = useWatch({ control, name: `${base}.curtain_type_id` });

  if (isToilet) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="col-span-2">
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Curtain Type
          </label>
          <div className="flex items-center gap-2">
            <select
              className={INPUT_CLS}
              {...register(`${base}.curtain_type_id`)}
            >
              <option value="">— Select —</option>
              {curtainTypes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label} ({c.category})
                </option>
              ))}
            </select>
            <Thumb options={curtainTypes} selectedId={toiletId} />
          </div>
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
        <div className="flex items-center gap-2">
          <select
            className={INPUT_CLS}
            {...register(`${base}.day_curtain_type_id`)}
          >
            <option value="">— None —</option>
            {dayTypes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          <Thumb options={dayTypes} selectedId={dayId} />
        </div>
      </div>
      <div className="col-span-2 sm:col-span-3">
        <label className="block text-xs font-medium text-slate-600 mb-1">
          Night Curtain
        </label>
        <div className="flex items-center gap-2">
          <select
            className={INPUT_CLS}
            {...register(`${base}.night_curtain_type_id`)}
          >
            <option value="">— None —</option>
            {nightTypes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          <Thumb options={nightTypes} selectedId={nightId} />
        </div>
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
        <select className={INPUT_CLS} {...register(`${base}.draw`)}>
          <option value="Double">Double</option>
          <option value="Single Left">Single Left</option>
          <option value="Single Right">Single Right</option>
        </select>
      </div>
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
