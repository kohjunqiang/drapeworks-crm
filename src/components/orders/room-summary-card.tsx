import type { RoomType } from "@/lib/db/schema";

import { PhotoStrip, type PhotoTile } from "./photo-strip";

type WindowSummary = {
  position: number;
  width_cm: number | null;
  height_cm: number | null;
  install_width_cm: number | null;
  notes: string | null;
  curtain_code: string | null;
  day_curtain_code: string | null;
  night_curtain_code: string | null;
  draw: string | null;
  curtain_name?: string | null;
  day_curtain_name?: string | null;
  night_curtain_name?: string | null;
};

type Props = {
  label: string;
  type: RoomType;
  windows: WindowSummary[];
  photos: PhotoTile[];
};

function isToilet(type: RoomType): boolean {
  return type === "Master Toilet" || type === "Common Toilet";
}

function dim(a: number | null, b: number | null): string {
  if (a == null && b == null) return "—";
  return `${a ?? "—"} × ${b ?? "—"}`;
}

function fabricCell(code: string | null, name?: string | null): string {
  if (!code) return "—";
  return name ? `${code} ${name}` : code;
}

export function RoomSummaryCard({ label, type, windows, photos }: Props) {
  const toilet = isToilet(type);
  return (
    <div className="border border-slate-200 rounded mb-3 overflow-hidden">
      <div className="bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-800 break-words">
        {label}
      </div>
      <div className="overflow-x-auto">
        {toilet ? (
          <table className="w-full text-xs min-w-[640px]">
            <thead className="text-slate-500">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Curtain</th>
                <th className="text-left px-4 py-2 font-medium">W × H</th>
                <th className="text-left px-4 py-2 font-medium">Install W</th>
                <th className="text-left px-4 py-2 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody className="text-slate-700">
              {windows.map((w) => (
                <tr key={w.position} className="border-t border-slate-100">
                  <td className="px-4 py-2">
                    {fabricCell(w.curtain_code, w.curtain_name)}
                  </td>
                  <td className="px-4 py-2">{dim(w.width_cm, w.height_cm)}</td>
                  <td className="px-4 py-2">{w.install_width_cm ?? "—"}</td>
                  <td className="px-4 py-2 text-slate-500">
                    {w.notes || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-xs min-w-[640px]">
            <thead className="text-slate-500">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Day Curtain</th>
                <th className="text-left px-4 py-2 font-medium">
                  Night Curtain
                </th>
                <th className="text-left px-4 py-2 font-medium">W × H</th>
                <th className="text-left px-4 py-2 font-medium">Install W</th>
                <th className="text-left px-4 py-2 font-medium">Draw</th>
                <th className="text-left px-4 py-2 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody className="text-slate-700">
              {windows.map((w) => (
                <tr key={w.position} className="border-t border-slate-100">
                  <td className="px-4 py-2">
                    {fabricCell(w.day_curtain_code, w.day_curtain_name)}
                  </td>
                  <td className="px-4 py-2">
                    {fabricCell(w.night_curtain_code, w.night_curtain_name)}
                  </td>
                  <td className="px-4 py-2">{dim(w.width_cm, w.height_cm)}</td>
                  <td className="px-4 py-2">{w.install_width_cm ?? "—"}</td>
                  <td className="px-4 py-2">{w.draw ?? "—"}</td>
                  <td className="px-4 py-2 text-slate-500">
                    {w.notes || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <PhotoStrip photos={photos} />
    </div>
  );
}
