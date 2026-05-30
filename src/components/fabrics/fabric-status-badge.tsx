import type { FabricStatus } from "@/lib/db/schema";

const STYLES: Record<FabricStatus, string> = {
  Active: "bg-emerald-100 text-emerald-700",
  Discontinued: "bg-slate-100 text-slate-600",
};

export function FabricStatusBadge({ status }: { status: FabricStatus }) {
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${STYLES[status]}`}
    >
      {status}
    </span>
  );
}
