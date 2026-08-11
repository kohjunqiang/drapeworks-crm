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
  depth_cm: number | null;
  draw: string | null;
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
  if (p.width_cm == null && p.height_cm == null && p.depth_cm == null)
    return "—";
  return `${cm(p.width_cm)} × ${cm(p.height_cm)} × ${cm(p.depth_cm)}`;
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
              <th className="text-left px-4 py-2 font-medium">
                W × H × D (cm)
              </th>
              <th className="text-left px-4 py-2 font-medium">Draw</th>
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
                <td className="px-4 py-2 text-slate-600">{dims(p)}</td>
                <td className="px-4 py-2 text-slate-600">{p.draw ?? "—"}</td>
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
