import type { RoomType } from "@/lib/db/schema";

import { PhotoStrip, type PhotoTile } from "./photo-strip";

type WindowSummary = {
  position: number;
  width_cm: number | null;
  height_cm: number | null;
  install_width_cm: number | null;
  notes: string | null;
  draw: string | null;
  add_s_fold?: boolean;
  add_slim_tracks?: boolean;
  day_curtain_label?: string | null;
  day_curtain_photo_url?: string | null;
  night_curtain_label?: string | null;
  night_curtain_photo_url?: string | null;
  curtain_label?: string | null;
  curtain_photo_url?: string | null;
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

// Curtain-type cell: small hero thumbnail + label. Em-dash when unselected.
function CurtainCell({
  label,
  photoUrl,
}: {
  label?: string | null;
  photoUrl?: string | null;
}) {
  if (!label) return <span>—</span>;
  return (
    <span className="inline-flex items-center gap-2">
      {photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photoUrl}
          alt={label}
          className="w-8 h-8 rounded object-cover border border-slate-200 flex-shrink-0"
        />
      ) : null}
      <span>{label}</span>
    </span>
  );
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
                    <CurtainCell
                      label={w.curtain_label}
                      photoUrl={w.curtain_photo_url}
                    />
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
                <th className="text-left px-4 py-2 font-medium">Add-ons</th>
                <th className="text-left px-4 py-2 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody className="text-slate-700">
              {windows.map((w) => (
                <tr key={w.position} className="border-t border-slate-100">
                  <td className="px-4 py-2">
                    <CurtainCell
                      label={w.day_curtain_label}
                      photoUrl={w.day_curtain_photo_url}
                    />
                  </td>
                  <td className="px-4 py-2">
                    <CurtainCell
                      label={w.night_curtain_label}
                      photoUrl={w.night_curtain_photo_url}
                    />
                  </td>
                  <td className="px-4 py-2">{dim(w.width_cm, w.height_cm)}</td>
                  <td className="px-4 py-2">{w.install_width_cm ?? "—"}</td>
                  <td className="px-4 py-2">{w.draw ?? "—"}</td>
                  <td className="px-4 py-2 text-slate-600">
                    {[
                      w.add_s_fold && "S-Fold",
                      w.add_slim_tracks && "Slim tracks",
                    ]
                      .filter(Boolean)
                      .join(", ") || "—"}
                  </td>
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
