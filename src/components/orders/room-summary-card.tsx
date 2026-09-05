import type { ReactNode } from "react";

import type { RoomType } from "@/lib/db/schema";

import { PhotoStrip, type PhotoTile } from "./photo-strip";

type WindowSummary = {
  position: number;
  width_cm: number | null;
  height_cm: number | null;
  installation_width_cm?: number | null;
  installation_height_cm?: number | null;
  notes: string | null;
  side_installation?: boolean;
  overlap_tracks_attachment?: boolean;
  draw: string | null;
  split_left_cm?: number | null;
  split_right_cm?: number | null;
  /** The add-ons this window carries, by name, in catalogue order. */
  addon_labels?: string[];
  combo_label?: string | null;
  day_curtain_label?: string | null;
  day_curtain_photo_url?: string | null;
  night_curtain_label?: string | null;
  night_curtain_photo_url?: string | null;
  // A blind occupies the window instead of curtains. Flagged explicitly rather
  // than inferred from blind_label, so an unselected blind still renders as a
  // blind row instead of silently reappearing as an empty curtain.
  is_blind?: boolean;
  blind_label?: string | null;
  blind_photo_url?: string | null;
};

type Props = {
  label: string;
  type: RoomType;
  windows: WindowSummary[];
  photos: PhotoTile[];
  orderControls?: ReactNode;
};

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

// Blinds table. Separate from the curtain tables because the columns genuinely
// differ — one covering, a control side, and none of the curtain add-ons.
function BlindTable({ windows }: { windows: WindowSummary[] }) {
  const hasInstallation = windows.some(
    (w) =>
      w.installation_width_cm != null || w.installation_height_cm != null,
  );
  return (
    <table className="w-full text-xs min-w-[640px]">
      <thead className="text-slate-500">
        <tr>
          <th className="text-left px-4 py-2 font-medium">Blind</th>
          <th className="text-left px-4 py-2 font-medium">Measured W × H</th>
          {hasInstallation && (
            <th className="text-left px-4 py-2 font-medium">
              Installation W × H
            </th>
          )}
          <th className="text-left px-4 py-2 font-medium">Control side</th>
          <th className="text-left px-4 py-2 font-medium">
            Installation note
          </th>
        </tr>
      </thead>
      <tbody className="text-slate-700">
        {windows.map((w) => (
          <tr key={w.position} className="border-t border-slate-100">
            <td className="px-4 py-2">
              <CurtainCell label={w.blind_label} photoUrl={w.blind_photo_url} />
            </td>
            <td className="px-4 py-2">{dim(w.width_cm, w.height_cm)}</td>
            {hasInstallation && (
              <td className="px-4 py-2 font-medium text-slate-900">
                {dim(w.installation_width_cm ?? null, w.installation_height_cm ?? null)}
              </td>
            )}
            <td className="px-4 py-2">
              {w.draw === "Single Left"
                ? "Left"
                : w.draw === "Single Right"
                  ? "Right"
                  : "—"}
            </td>
            <td className="px-4 py-2 text-slate-500">
              {[
                w.side_installation ? "Side installation" : null,
                w.notes,
              ]
                .filter(Boolean)
                .join(" · ") || "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function RoomSummaryCard({ label, windows, photos, orderControls }: Props) {
  // A room can mix the two — curtains on one window, a blind on the next — so
  // the split is per window, not per room.
  const blindWindows = windows.filter((w) => w.is_blind);
  const curtainWindows = windows.filter((w) => !w.is_blind);
  const hasCurtainInstallation = curtainWindows.some(
    (w) =>
      w.installation_width_cm != null || w.installation_height_cm != null,
  );
  return (
    <div className="border border-slate-200 rounded mb-3 overflow-hidden">
      <div className="flex items-center justify-between gap-3 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-800">
        <span className="break-words">{label}</span>
        {orderControls}
      </div>
      <div className="overflow-x-auto">
        {curtainWindows.length > 0 && (
          <table className="w-full text-xs min-w-[640px]">
            <thead className="text-slate-500">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Day Curtain</th>
                <th className="text-left px-4 py-2 font-medium">
                  Night Curtain
                </th>
                <th className="text-left px-4 py-2 font-medium">
                  Measured W × H
                </th>
                {hasCurtainInstallation && (
                  <th className="text-left px-4 py-2 font-medium">
                    Installation W × H
                  </th>
                )}
                <th className="text-left px-4 py-2 font-medium">Draw</th>
                <th className="text-left px-4 py-2 font-medium">Add-ons</th>
                <th className="text-left px-4 py-2 font-medium">
                  Installation note
                </th>
              </tr>
            </thead>
            <tbody className="text-slate-700">
              {curtainWindows.map((w) => (
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
                  {hasCurtainInstallation && (
                    <td className="px-4 py-2 font-medium text-slate-900">
                      {dim(
                        w.installation_width_cm ?? null,
                        w.installation_height_cm ?? null,
                      )}
                    </td>
                  )}
                  <td className="px-4 py-2">
                    {w.draw ?? "—"}
                    {w.draw === "Double" &&
                      w.split_left_cm != null &&
                      w.split_right_cm != null && (
                        <span className="block text-[11px] text-slate-500">
                          L {w.split_left_cm} cm · R {w.split_right_cm} cm
                        </span>
                      )}
                  </td>
                  <td className="px-4 py-2 text-slate-600">
                    <div className="flex flex-col gap-1">
                      <span>{w.addon_labels?.join(", ") || "—"}</span>
                      {w.combo_label && (
                        <span className="inline-flex w-fit items-center gap-1 rounded bg-amber-50 border border-amber-200 px-1.5 py-0.5 text-[11px] text-amber-800">
                          🏷 {w.combo_label}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-slate-500">
                    {[
                      w.side_installation ? "Side installation" : null,
                      w.overlap_tracks_attachment
                        ? "Overlap tracks / attachment"
                        : null,
                      w.notes,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {blindWindows.length > 0 && <BlindTable windows={blindWindows} />}
      </div>
      <PhotoStrip photos={photos} />
    </div>
  );
}
