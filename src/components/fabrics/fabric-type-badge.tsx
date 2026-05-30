import type { FabricType } from "@/lib/db/schema";

const STYLES: Record<FabricType, string> = {
  Day: "bg-teal-100 text-teal-700",
  Night: "bg-indigo-100 text-indigo-700",
  Both: "bg-slate-200 text-slate-700",
};

export function FabricTypeBadge({ type }: { type: FabricType }) {
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${STYLES[type]}`}
    >
      {type}
    </span>
  );
}
