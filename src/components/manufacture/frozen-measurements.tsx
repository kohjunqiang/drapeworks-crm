// The reconciliation view once the order has gone to the vendor.
//
// Renders the STORED manufacture_measurements rows, never a recomputed
// candidate. Once confirmed, the stored row is what the vendor was told; if an
// admin later changes an allowance, recomputing here would quietly show a
// different number than the one being cut.

import { DeltaChip } from "./delta-chip";

export type FrozenLine = {
  lineId: string;
  label: string;
  description: string | null;
  sourceWidthCm: number;
  sourceHeightCm: number;
  widthDeltaCm: number;
  heightDeltaCm: number;
  mfgWidthCm: number;
  mfgHeightCm: number;
  sourceSplitLeftCm: number | null;
  sourceSplitRightCm: number | null;
  mfgSplitLeftCm: number | null;
  mfgSplitRightCm: number | null;
  isOverridden: boolean;
  overrideReason: string | null;
};

export type FrozenRoom = { roomId: string; label: string; lines: FrozenLine[] };

function Pair({
  label,
  measured,
  made,
  delta,
  overridden,
}: {
  label: string;
  measured: number;
  made: number;
  delta: number;
  overridden: boolean;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div className="flex items-baseline gap-2">
        <span className="w-14 shrink-0 text-xs text-slate-500">{label}</span>
        <span className="text-sm text-slate-600 tabular-nums">
          {measured} cm
        </span>
      </div>
      <div className="flex items-center gap-2 flex-wrap sm:pl-4 sm:border-l sm:border-slate-200">
        <span className="w-14 shrink-0 text-xs text-slate-500 sm:hidden">
          {label}
        </span>
        <span className="text-sm font-semibold text-slate-900 tabular-nums">
          {made} cm
        </span>
        <DeltaChip delta={delta} source={overridden ? "person" : "rule"} />
      </div>
    </div>
  );
}

export function FrozenMeasurements({ rooms }: { rooms: FrozenRoom[] }) {
  if (rooms.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        No manufacturing measurements were recorded for this order.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {rooms.map((room) => (
        <div
          key={room.roomId}
          className="border border-slate-200 rounded overflow-hidden bg-white"
        >
          <div className="bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-800 break-words">
            {room.label}
          </div>
          <div className="hidden sm:grid grid-cols-2 gap-3 px-4 py-1.5 border-t border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
            <div>Measured</div>
            <div className="pl-4">Installation</div>
          </div>
          {room.lines.map((line) => (
            <div
              key={line.lineId}
              className={`border-t border-slate-100 px-4 py-3 ${
                line.isOverridden ? "bg-amber-50/50" : ""
              }`}
            >
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 mb-2">
                <span className="text-sm font-semibold text-slate-900">
                  {line.label}
                </span>
                {line.description && (
                  <span className="text-xs text-slate-500 break-words">
                    {line.description}
                  </span>
                )}
                {line.isOverridden && (
                  <span className="inline-flex items-center rounded bg-amber-100 border border-amber-300 px-1.5 py-0.5 text-[11px] font-medium text-amber-900">
                    Set by hand
                  </span>
                )}
              </div>
              {line.sourceSplitLeftCm != null &&
                line.sourceSplitRightCm != null &&
                line.mfgSplitLeftCm != null &&
                line.mfgSplitRightCm != null && (
                  <div className="mb-3 inline-flex flex-wrap items-center gap-x-2 rounded border border-teal-200 bg-teal-50 px-2.5 py-1.5 text-xs font-medium text-teal-900 tabular-nums">
                    <span>Double-draw split</span>
                    <span>
                      Measured L {line.sourceSplitLeftCm} cm · R {line.sourceSplitRightCm} cm
                      {" → "}PO L {line.mfgSplitLeftCm} cm · R {line.mfgSplitRightCm} cm
                    </span>
                  </div>
                )}
              <div className="space-y-1">
                <Pair
                  label="Width"
                  measured={line.sourceWidthCm}
                  made={line.mfgWidthCm}
                  delta={line.widthDeltaCm}
                  overridden={line.isOverridden}
                />
                <Pair
                  label="Height"
                  measured={line.sourceHeightCm}
                  made={line.mfgHeightCm}
                  delta={line.heightDeltaCm}
                  overridden={line.isOverridden}
                />
              </div>
              {line.isOverridden && line.overrideReason && (
                <p className="mt-2 text-xs text-amber-900 break-words">
                  <span className="font-medium">Reason:</span>{" "}
                  {line.overrideReason}
                </p>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
