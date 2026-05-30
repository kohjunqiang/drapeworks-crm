"use client";

import { useFormContext } from "react-hook-form";

import type { OrderEditInput } from "@/lib/validation/order";

export type FabricOption = {
  code: string;
  name: string;
  type: "Day" | "Night" | "Both";
};

const INPUT_CLS =
  "w-full px-2.5 py-1.5 border border-slate-200 rounded text-sm focus:outline-none focus:border-teal-500 bg-white";

type Props = {
  roomIndex: number;
  windowIndex: number;
  isToilet: boolean;
  fabrics: FabricOption[];
};

export function WindowFields({
  roomIndex,
  windowIndex,
  isToilet,
  fabrics,
}: Props) {
  const { register } = useFormContext<OrderEditInput>();
  const base = `rooms.${roomIndex}.windows.${windowIndex}` as const;

  const dayFabrics = fabrics.filter((f) => f.type === "Day" || f.type === "Both");
  const nightFabrics = fabrics.filter((f) => f.type === "Night" || f.type === "Both");

  if (isToilet) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="col-span-2">
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Curtain Type / Code
          </label>
          <select className={INPUT_CLS} {...register(`${base}.curtain_code`)}>
            <option value="">— Select —</option>
            {fabrics.map((f) => (
              <option key={f.code} value={f.code}>
                {f.code} — {f.name}
              </option>
            ))}
          </select>
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
        <select className={INPUT_CLS} {...register(`${base}.day_curtain_code`)}>
          <option value="">— None —</option>
          {dayFabrics.map((f) => (
            <option key={f.code} value={f.code}>
              {f.code} — {f.name}
            </option>
          ))}
        </select>
      </div>
      <div className="col-span-2 sm:col-span-3">
        <label className="block text-xs font-medium text-slate-600 mb-1">
          Night Curtain
        </label>
        <select
          className={INPUT_CLS}
          {...register(`${base}.night_curtain_code`)}
        >
          <option value="">— None —</option>
          {nightFabrics.map((f) => (
            <option key={f.code} value={f.code}>
              {f.code} — {f.name}
            </option>
          ))}
        </select>
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
