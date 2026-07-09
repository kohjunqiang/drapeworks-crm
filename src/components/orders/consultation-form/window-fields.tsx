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
  "w-full px-2.5 py-2 border border-slate-200 rounded text-sm focus:outline-none focus:border-teal-500 bg-white";

type Props = {
  roomIndex: number;
  windowIndex: number;
  isToilet: boolean;
  curtainTypes: CurtainTypeOption[];
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
        <Preview options={dayTypes} selectedId={dayId} />
      </div>
      <div className="col-span-2 sm:col-span-3">
        <label className="block text-xs font-medium text-slate-600 mb-1">
          Night Curtain
        </label>
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
