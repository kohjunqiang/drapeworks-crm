"use client";

import type { RoomType } from "@/lib/db/schema";

type Template = { label: string; type: RoomType };

// THREE HAND-MAINTAINED LISTS MIRROR public.room_type AND MUST MOVE TOGETHER:
//
//   1. ROOM_TYPES in src/lib/validation/order.ts   (the Zod enum)
//   2. ROOM_TYPE_OPTIONS in ./room-shell.tsx       (the room's type dropdown)
//   3. TEMPLATES below                             (these quick-add buttons)
//
// Adding 'Service Yard' to the enum updated the first two and missed this one,
// and nothing caught it: `Template[]` type-checks each ENTRY against RoomType
// but never asks whether the array is exhaustive, so tsc is happy with a list
// that stops short. The symptom is silent — a room type a consultant simply
// cannot reach from the quick-add bar.
//
// 'Other' is deliberately not here. It is the escape hatch on the dropdown, not
// something anyone wants a one-tap button for; leave it out.
const TEMPLATES: Template[] = [
  { label: "Living Room", type: "Living Room" },
  { label: "Master Bedroom", type: "Master Bedroom" },
  { label: "Bedroom", type: "Bedroom" },
  { label: "Master Toilet", type: "Master Toilet" },
  { label: "Common Toilet", type: "Common Toilet" },
  { label: "Kitchen", type: "Kitchen" },
  { label: "Study Room", type: "Study Room" },
  { label: "Balcony", type: "Balcony" },
  { label: "Service Yard", type: "Service Yard" },
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
