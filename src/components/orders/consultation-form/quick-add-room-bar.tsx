"use client";

import type { RoomType } from "@/lib/db/schema";

type Template = { label: string; type: RoomType };

const TEMPLATES: Template[] = [
  { label: "Living Room", type: "Living Room" },
  { label: "Master Bedroom", type: "Master Bedroom" },
  { label: "Bedroom", type: "Bedroom" },
  { label: "Master Toilet", type: "Master Toilet" },
  { label: "Common Toilet", type: "Common Toilet" },
  { label: "Kitchen", type: "Kitchen" },
  { label: "Study Room", type: "Study Room" },
  { label: "Balcony", type: "Balcony" },
];

type Props = {
  onAdd: (template: Template) => void;
};

export function QuickAddRoomBar({ onAdd }: Props) {
  return (
    <div className="border border-dashed border-slate-300 rounded p-3 mb-4 bg-slate-50">
      <div className="text-xs font-medium text-slate-600 mb-2">Quick add:</div>
      <div className="flex flex-wrap gap-2">
        {TEMPLATES.map((t) => (
          <button
            key={t.label}
            type="button"
            onClick={() => onAdd(t)}
            className="text-xs bg-white border border-slate-200 hover:border-teal-500 hover:text-teal-700 px-2.5 py-1 rounded"
          >
            + {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export type RoomTemplate = Template;
