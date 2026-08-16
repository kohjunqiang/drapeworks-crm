import { meshMountSurface } from "@/lib/orders/mesh-panel-values";
import type { RoomType } from "@/lib/db/schema";

import { PhotoStrip, type PhotoTile } from "./photo-strip";

// The mesh equivalent of RoomSummaryCard. A panel and a curtain window share no
// columns, so this is a parallel component rather than a branch inside that one.

export type MeshPanelSummary = {
  position: number;
  category_name: string | null;
  colour_name: string | null;
  width_cm: number | null;
  height_cm: number | null;
  has_window: boolean;
  has_inset: boolean;
  draw: string | null;
  /** Derived from width and draw at render time, never stored (§5.9). */
  system: string | null;
  /** Cut length after the hardware, in cm. Derived alongside the system. */
  trackCm: string | null;
  split_left_cm: number | null;
  split_right_cm: number | null;
  notes: string | null;
};

type Props = {
  label: string;
  type: RoomType;
  panels: MeshPanelSummary[];
  photos: PhotoTile[];
};

const cm = (v: number | null): string => (v == null ? "—" : `${v}`);

function dims(p: MeshPanelSummary): string {
  if (p.width_cm == null && p.height_cm == null) return "—";
  return `${cm(p.width_cm)} × ${cm(p.height_cm)}`;
}

// A split only exists for a double draw, and the server nulls it otherwise, so
// an absent split here is genuinely absent rather than merely hidden.
function split(p: MeshPanelSummary): string {
  if (p.split_left_cm == null && p.split_right_cm == null) return "—";
  return `${cm(p.split_left_cm)} + ${cm(p.split_right_cm)}`;
}

export function MeshRoomSummaryCard({ label, type, panels, photos }: Props) {
  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden mb-4">
      <div className="bg-slate-50 px-4 py-2.5 border-b border-slate-200 flex items-center justify-between gap-2">
        <span className="font-medium text-slate-900 text-sm">{label}</span>
        <span className="text-xs text-slate-500">{type}</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[44rem]">
          <thead className="bg-white border-b border-slate-100 text-slate-500">
            <tr>
              <th className="text-left px-4 py-2 font-medium w-16">#</th>
              <th className="text-left px-4 py-2 font-medium">Category</th>
              <th className="text-left px-4 py-2 font-medium">Colour</th>
              <th className="text-left px-4 py-2 font-medium">W × H (cm)</th>
              <th className="text-left px-4 py-2 font-medium">Fixing to</th>
              <th className="text-left px-4 py-2 font-medium">Draw</th>
              <th className="text-left px-4 py-2 font-medium">System</th>
              <th className="text-left px-4 py-2 font-medium">Track (cm)</th>
              <th className="text-left px-4 py-2 font-medium">Split (cm)</th>
              <th className="text-left px-4 py-2 font-medium">Notes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {panels.map((p, i) => (
              <tr key={p.position}>
                <td className="px-4 py-2 text-slate-500">{i + 1}</td>
                <td className="px-4 py-2 text-slate-900">
                  {p.category_name ?? "—"}
                </td>
                <td className="px-4 py-2 text-slate-600">
                  {p.colour_name ?? "—"}
                </td>
                <td className="px-4 py-2 text-slate-600">
                  <span className="inline-flex items-center gap-1.5">
                    {dims(p)}
                    {/* Rides with the size rather than getting its own column,
                        because that is what it constrains: made to size, no
                        overhang. */}
                    {p.has_inset && (
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
                        inset
                      </span>
                    )}
                  </span>
                </td>
                <td className="px-4 py-2 text-slate-600">
                  {p.has_window ? (
                    meshMountSurface(true)
                  ) : (
                    // The exception, so it earns emphasis: the handyman needs
                    // to arrive with wall plugs rather than self-tappers.
                    <span className="font-medium text-amber-700">
                      {meshMountSurface(false)}
                    </span>
                  )}
                </td>
                <td className="px-4 py-2 text-slate-600">{p.draw ?? "—"}</td>
                <td className="px-4 py-2 font-medium text-slate-900">
                  {p.system ?? "—"}
                </td>
                <td className="px-4 py-2 font-medium text-slate-900 tabular-nums">
                  {p.trackCm ?? "—"}
                </td>
                <td className="px-4 py-2 text-slate-600">{split(p)}</td>
                <td className="px-4 py-2 text-slate-500">{p.notes ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {panels.length === 0 && (
        <div className="px-4 py-6 text-center text-sm text-slate-500">
          No panels recorded for this room.
        </div>
      )}

      {photos.length > 0 && (
        <div className="px-4 py-3 border-t border-slate-100">
          <PhotoStrip photos={photos} />
        </div>
      )}
    </div>
  );
}
