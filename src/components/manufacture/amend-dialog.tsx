"use client";

// Admin-only correction of measurements that have already gone to the vendor.
//
// Deliberately a dialog rather than an inline editor: the frozen view's job is
// to state what the vendor was told, and letting fields on it look editable
// would undermine that. Amending is a separate, explicit act.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { amendManufactureMeasurements } from "@/lib/actions/manufacture";

import { MINUS, signedCm } from "./delta-chip";

export type AmendLine = {
  lineId: string;
  /** Room and item, e.g. "Master Bedroom — Window 1". */
  label: string;
  sourceWidthCm: number;
  sourceHeightCm: number;
  mfgWidthCm: number;
  mfgHeightCm: number;
  mfgSplitLeftCm: number | null;
  mfgSplitRightCm: number | null;
};

type Draft = {
  width: string;
  height: string;
  splitLeft: string;
  splitRight: string;
};

// Whole positive centimetres only, matching amendManufactureLineSchema.
function parseCm(s: string): number | null {
  const t = s.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

const INPUT =
  "w-20 px-2 py-1 border rounded text-sm text-right tabular-nums " +
  "focus:outline-none focus:border-teal-500";

export function AmendDialog({
  orderId,
  lines,
}: {
  orderId: string;
  lines: AmendLine[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  const initial = useMemo(
    () =>
      Object.fromEntries(
        lines.map((l) => [
          l.lineId,
          {
            width: String(l.mfgWidthCm),
            height: String(l.mfgHeightCm),
            splitLeft:
              l.mfgSplitLeftCm == null ? "" : String(l.mfgSplitLeftCm),
            splitRight:
              l.mfgSplitRightCm == null ? "" : String(l.mfgSplitRightCm),
          },
        ]),
      ) as Record<string, Draft>,
    [lines],
  );
  const [drafts, setDrafts] = useState<Record<string, Draft>>(initial);

  // Only lines a person actually moved are sent. Submitting every row would
  // stamp is_overridden on the whole order for a one-window correction.
  const changed = lines.filter((l) => {
    const d = drafts[l.lineId];
    return (
      d.width !== String(l.mfgWidthCm) ||
      d.height !== String(l.mfgHeightCm) ||
      d.splitLeft !==
        (l.mfgSplitLeftCm == null ? "" : String(l.mfgSplitLeftCm)) ||
      d.splitRight !==
        (l.mfgSplitRightCm == null ? "" : String(l.mfgSplitRightCm))
    );
  });
  const invalid = changed.filter((l) => {
    const d = drafts[l.lineId];
    const splitLeft = l.mfgSplitLeftCm == null ? null : parseCm(d.splitLeft);
    const splitRight = l.mfgSplitRightCm == null ? null : parseCm(d.splitRight);
    const width = parseCm(d.width);
    return (
      width == null ||
      parseCm(d.height) == null ||
      (l.mfgSplitLeftCm != null &&
        (splitLeft == null ||
          splitRight == null ||
          splitLeft + splitRight !== width))
    );
  });
  const canSubmit =
    changed.length > 0 &&
    invalid.length === 0 &&
    reason.trim().length > 0 &&
    !pending;

  function close(next: boolean) {
    setOpen(next);
    if (!next) {
      // Reset on close so a cancelled amendment does not sit there half-typed,
      // waiting to be submitted by someone who reopens the dialog later.
      setDrafts(initial);
      setReason("");
    }
  }

  function submit() {
    const payload = changed.map((l) => ({
      lineId: l.lineId,
      mfgWidthCm: parseCm(drafts[l.lineId].width)!,
      mfgHeightCm: parseCm(drafts[l.lineId].height)!,
      ...(l.mfgSplitLeftCm != null && l.mfgSplitRightCm != null
        ? {
            mfgSplitLeftCm: parseCm(drafts[l.lineId].splitLeft)!,
            mfgSplitRightCm: parseCm(drafts[l.lineId].splitRight)!,
          }
        : {}),
    }));

    startTransition(async () => {
      try {
        await amendManufactureMeasurements({
          orderId,
          lines: payload,
          reason: reason.trim(),
        });
        toast.success(
          `Amended ${payload.length} ${payload.length === 1 ? "measurement" : "measurements"}`,
        );
        close(false);
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not amend");
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="px-1 py-1 text-xs sm:text-sm text-amber-800 underline underline-offset-2 hover:text-amber-950 whitespace-nowrap"
      >
        Amend measurements
      </button>

      <Dialog open={open} onOpenChange={close}>
        <DialogContent className="sm:max-w-2xl max-h-[85dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Amend manufacturing measurements</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              The vendor already has these dimensions. Amending records the
              change on the order timeline and marks the line as set by hand;
              the order stays at Sent to Vendor. Tell the vendor separately —
              this does not.
            </p>

            <div className="border border-slate-200 rounded divide-y divide-slate-100">
              {lines.map((l) => {
                const d = drafts[l.lineId];
                const w = parseCm(d.width);
                const h = parseCm(d.height);
                const splitLeft = parseCm(d.splitLeft);
                const splitRight = parseCm(d.splitRight);
                const hasSplit =
                  l.mfgSplitLeftCm != null && l.mfgSplitRightCm != null;
                const splitValid =
                  !hasSplit ||
                  (splitLeft != null &&
                    splitRight != null &&
                    w != null &&
                    splitLeft + splitRight === w);
                const moved =
                  d.width !== String(l.mfgWidthCm) ||
                  d.height !== String(l.mfgHeightCm) ||
                  d.splitLeft !==
                    (l.mfgSplitLeftCm == null ? "" : String(l.mfgSplitLeftCm)) ||
                  d.splitRight !==
                    (l.mfgSplitRightCm == null ? "" : String(l.mfgSplitRightCm));
                return (
                  <div
                    key={l.lineId}
                    className={`px-3 py-2 ${moved ? "bg-amber-50/60" : ""}`}
                  >
                    <div className="text-xs font-medium text-slate-800 mb-1 break-words">
                      {l.label}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                      <span className="text-xs text-slate-500 tabular-nums">
                        Measured {l.sourceWidthCm} × {l.sourceHeightCm} cm
                      </span>
                      <label className="flex items-center gap-1.5 text-xs text-slate-600">
                        W
                        <input
                          inputMode="numeric"
                          aria-label={`${l.label} manufacturing width in cm`}
                          disabled={pending}
                          value={d.width}
                          onChange={(e) =>
                            setDrafts((s) => ({
                              ...s,
                              [l.lineId]: { ...s[l.lineId], width: e.target.value },
                            }))
                          }
                          className={`${INPUT} ${
                            w == null
                              ? "border-rose-400 bg-rose-50"
                              : moved
                                ? "border-amber-400 bg-white"
                                : "border-slate-200 bg-white"
                          }`}
                        />
                      </label>
                      <label className="flex items-center gap-1.5 text-xs text-slate-600">
                        H
                        <input
                          inputMode="numeric"
                          aria-label={`${l.label} manufacturing height in cm`}
                          disabled={pending}
                          value={d.height}
                          onChange={(e) =>
                            setDrafts((s) => ({
                              ...s,
                              [l.lineId]: {
                                ...s[l.lineId],
                                height: e.target.value,
                              },
                            }))
                          }
                          className={`${INPUT} ${
                            h == null
                              ? "border-rose-400 bg-rose-50"
                              : moved
                                ? "border-amber-400 bg-white"
                                : "border-slate-200 bg-white"
                          }`}
                        />
                      </label>
                      {moved && w != null && h != null && (
                        <span className="text-xs text-amber-900 tabular-nums">
                          was {l.mfgWidthCm} × {l.mfgHeightCm} cm · now{" "}
                          {signedCm(w - l.sourceWidthCm)} /{" "}
                          {signedCm(h - l.sourceHeightCm)} on the opening
                        </span>
                      )}
                      {(w == null || h == null) && (
                        <span className="text-xs text-rose-700">
                          Whole centimetres above zero only.
                        </span>
                      )}
                    </div>
                    {hasSplit && (
                      <fieldset className="mt-2 rounded-md border border-teal-200 bg-teal-50/70 px-3 py-2">
                        <legend className="px-1 text-[10px] font-semibold uppercase tracking-wide text-teal-800">
                          Width split · two single draws
                        </legend>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                          <span className="mr-1 text-slate-500">
                            Current PO L {l.mfgSplitLeftCm} · R{" "}
                            {l.mfgSplitRightCm} cm
                          </span>
                          <span aria-hidden="true" className="text-slate-400">
                            →
                          </span>
                          <label className="flex items-center gap-1">
                            New L
                            <input
                              inputMode="numeric"
                              aria-label={`${l.label} left single-draw width in cm`}
                              disabled={pending}
                              value={d.splitLeft}
                              onChange={(e) =>
                                setDrafts((state) => ({
                                  ...state,
                                  [l.lineId]: {
                                    ...state[l.lineId],
                                    splitLeft: e.target.value,
                                  },
                                }))
                              }
                              className={`${INPUT} ${
                                splitLeft == null
                                  ? "border-rose-400 bg-rose-50"
                                  : "border-teal-300 bg-white"
                              }`}
                            />
                          </label>
                          <label className="flex items-center gap-1">
                            New R
                            <input
                              inputMode="numeric"
                              aria-label={`${l.label} right single-draw width in cm`}
                              disabled={pending}
                              value={d.splitRight}
                              onChange={(e) =>
                                setDrafts((state) => ({
                                  ...state,
                                  [l.lineId]: {
                                    ...state[l.lineId],
                                    splitRight: e.target.value,
                                  },
                                }))
                              }
                              className={`${INPUT} ${
                                splitRight == null
                                  ? "border-rose-400 bg-rose-50"
                                  : "border-teal-300 bg-white"
                              }`}
                            />
                          </label>
                          <span className="tabular-nums text-slate-500">
                            Total{" "}
                            {splitLeft != null && splitRight != null
                              ? splitLeft + splitRight
                              : "—"}{" "}
                            / {w ?? "—"} cm
                          </span>
                        </div>
                        {!splitValid && (
                          <p className="mt-1.5 text-xs text-rose-700">
                            Left + right must equal the amended manufacturing
                            width.
                          </p>
                        )}
                      </fieldset>
                    )}
                  </div>
                );
              })}
            </div>

            <div>
              <label
                htmlFor="amend-reason"
                className="block text-xs font-medium text-slate-600 mb-1"
              >
                Why? (required — goes on the order timeline)
              </label>
              <textarea
                id="amend-reason"
                rows={3}
                maxLength={500}
                disabled={pending}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={`e.g. vendor called ${MINUS} the Living Room rail is 6cm shorter than drawn`}
                className="w-full px-3 py-2 border border-slate-200 rounded text-sm bg-white focus:outline-none focus:border-teal-500"
              />
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
              <span className="mr-auto text-xs text-slate-500">
                {changed.length === 0
                  ? "Nothing changed yet."
                  : `${changed.length} ${changed.length === 1 ? "line" : "lines"} will be amended.`}
              </span>
              <button
                type="button"
                onClick={() => close(false)}
                disabled={pending}
                className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-900"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={!canSubmit}
                className="px-4 py-1.5 text-sm bg-amber-600 hover:bg-amber-700 disabled:bg-slate-300 text-white rounded font-medium"
              >
                {pending ? "Amending…" : "Amend measurements"}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
