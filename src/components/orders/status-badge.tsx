import { STATUS_COLOURS, STATUS_LABELS } from "@/lib/status-flow";
import type { FulfilmentStatus } from "@/lib/db/schema";

export function StatusBadge({ status }: { status: FulfilmentStatus }) {
  return (
    <span
      className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLOURS[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}
