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
import type { DrawDirection } from "@/lib/db/schema";
import {
  beadShapeFor,
  parseBeadCount,
} from "@/lib/manufacture/sfold-beads";

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
  /** Whether this curtain takes S-fold runners — decides the bead inputs. */
  sFold: boolean;
  draw: DrawDirection | null;
  /** The stored bead counts, null when the row predates their recording. */
  beadCount: number | null;
  beadLeft: number | null;
  beadRight: number | null;
};

type Draft = {
  width: string;
  height: string;
  splitLeft: string;
  splitRight: string;
  beadCount: string;
  beadLeft: string;
  beadRight: string;
};

// Positive centimetres with up to two decimal places, matching amendManufactureLineSchema.
function parseCm(s: string): number | null {
  const t = s.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Bead fields are opt-in on an amendment: blank on an unrecorded row means
// "keep the PO's calculated count", not "invalid". A row that HAS a stored
// count cannot be blanked back to the derived value — there is no clearing.
function beadFieldsValid(l: AmendLine, d: Draft): boolean {
  if (!l.sFold) return true;
  if (beadShapeFor(l.draw) === "pair") {
    const bothBlank =
      d.beadLeft.trim() === "" && d.beadRight.trim() === "";
    if (bothBlank) return l.beadLeft == null && l.beadRight == null;
    return (
      parseBeadCount(d.beadLeft) != null && parseBeadCount(d.beadRight) != null
    );
  }
  if (d.beadCount.trim() === "") return l.beadCount == null;
  return parseBeadCount(d.beadCount) != null;
}

/** The bead fields to send for one line — empty when nothing should change. */
function beadPayload(l: AmendLine, d: Draft) {
  if (!l.sFold || !beadChanged(l, d)) return {};
  if (beadShapeFor(l.draw) === "pair") {
    const left = parseBeadCount(d.beadLeft);
    const right = parseBeadCount(d.beadRight);
    return left != null && right != null
      ? { sFoldBeadLeft: left, sFoldBeadRight: right }
      : {};
  }
  const count = parseBeadCount(d.beadCount);
  return count != null ? { sFoldBeadCount: count } : {};
}

function beadChanged(l: AmendLine, d: Draft): boolean {
  return (
    d.beadCount !== (l.beadCount == null ? "" : String(l.beadCount)) ||
    d.beadLeft !== (l.beadLeft == null ? "" : String(l.beadLeft)) ||
    d.beadRight !== (l.beadRight == null ? "" : String(l.beadRight))
  );
}

const INPUT =
  "w-20 px-2 py-1 border rounded text-sm text-right tabular-nums " +
  "focus:outline-none focus:border-teal-500";

// Bead inputs get the mobile treatment the dimension inputs in the dialog are
// missing: a 44px touch target and 16px text below sm, compact above it.
const BEAD_INPUT =
  "w-20 min-h-11 px-3 py-2.5 sm:min-h-0 sm:px-2 sm:py-1 border rounded " +
  "text-base sm:text-sm text-right tabular-nums " +
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
            beadCount: l.beadCount == null ? "" : String(l.beadCount),
            beadLeft: l.beadLeft == null ? "" : String(l.beadLeft),
            beadRight: l.beadRight == null ? "" : String(l.beadRight),
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
        (l.mfgSplitRightCm == null ? "" : String(l.mfgSplitRightCm)) ||
      beadChanged(l, d)
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
          Math.abs(splitLeft + splitRight - width) > 0.000001)) ||
      !beadFieldsValid(l, d)
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
      ...beadPayload(l, drafts[l.lineId]),
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
                    w != null && Math.abs(splitLeft + splitRight - w) < 0.000001);
                const moved =
                  d.width !== String(l.mfgWidthCm) ||
                  d.height !== String(l.mfgHeightCm) ||
                  d.splitLeft !==
                    (l.mfgSplitLeftCm == null ? "" : String(l.mfgSplitLeftCm)) ||
                  d.splitRight !==
                    (l.mfgSplitRightCm == null ? "" : String(l.mfgSplitRightCm)) ||
                  beadChanged(l, d);
                const beadsOk = beadFieldsValid(l, d);
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
                          inputMode="decimal"
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
                          inputMode="decimal"
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
                          <span className="w-full text-slate-500">
                            Current PO L {l.mfgSplitLeftCm} · R{" "}
                            {l.mfgSplitRightCm} cm
                          </span>
                          <span aria-hidden="true" className="text-slate-400">
                            →
                          </span>
                          <label className="flex items-center gap-1">
                            New L
                            <input
                              inputMode="decimal"
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
                              inputMode="decimal"
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
                    {l.sFold && (
                      <fieldset className="mt-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                        <legend className="px-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                          S-fold beads
                        </legend>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                          <span className="w-full text-slate-500">
                            {l.beadCount != null
                              ? `Current ${l.beadCount}`
                              : l.beadLeft != null && l.beadRight != null
                                ? `Current L ${l.beadLeft} · R ${l.beadRight}`
                                : "Not recorded — the PO calculates the count"}
                          </span>
                          {beadShapeFor(l.draw) === "pair" ? (
                            <>
                              <label className="flex items-center gap-1">
                                L
                                <input
                                  inputMode="numeric"
                                  aria-label={`${l.label} S-fold left bead count`}
                                  aria-invalid={!beadsOk}
                                  disabled={pending}
                                  value={d.beadLeft}
                                  onChange={(e) =>
                                    setDrafts((state) => ({
                                      ...state,
                                      [l.lineId]: {
                                        ...state[l.lineId],
                                        beadLeft: e.target.value,
                                      },
                                    }))
                                  }
                                  className={`${BEAD_INPUT} ${
                                    !beadsOk && parseBeadCount(d.beadLeft) == null
                                      ? "border-rose-400 bg-rose-50"
                                      : "border-slate-300 bg-white"
                                  }`}
                                />
                              </label>
                              <label className="flex items-center gap-1">
                                R
                                <input
                                  inputMode="numeric"
                                  aria-label={`${l.label} S-fold right bead count`}
                                  aria-invalid={!beadsOk}
                                  disabled={pending}
                                  value={d.beadRight}
                                  onChange={(e) =>
                                    setDrafts((state) => ({
                                      ...state,
                                      [l.lineId]: {
                                        ...state[l.lineId],
                                        beadRight: e.target.value,
                                      },
                                    }))
                                  }
                                  className={`${BEAD_INPUT} ${
                                    !beadsOk && parseBeadCount(d.beadRight) == null
                                      ? "border-rose-400 bg-rose-50"
                                      : "border-slate-300 bg-white"
                                  }`}
                                />
                              </label>
                            </>
                          ) : (
                            <label className="flex items-center gap-1">
                              New
                              <input
                                inputMode="numeric"
                                aria-label={`${l.label} S-fold bead count`}
                                aria-invalid={!beadsOk}
                                disabled={pending}
                                value={d.beadCount}
                                onChange={(e) =>
                                  setDrafts((state) => ({
                                    ...state,
                                    [l.lineId]: {
                                      ...state[l.lineId],
                                      beadCount: e.target.value,
                                    },
                                  }))
                                }
                                className={`${BEAD_INPUT} ${
                                  !beadsOk && parseBeadCount(d.beadCount) == null
                                    ? "border-rose-400 bg-rose-50"
                                    : "border-slate-300 bg-white"
                                }`}
                              />
                            </label>
                          )}
                        </div>
                        {!beadsOk ? (
                          <p className="mt-1.5 text-xs text-rose-700">
                            Bead counts must be positive even whole numbers
                            {beadShapeFor(l.draw) === "pair"
                              ? ", one for each side"
                              : ""}
                            .
                          </p>
                        ) : l.beadCount == null && l.beadLeft == null ? (
                          <p className="mt-1.5 text-xs text-slate-500">
                            Leave blank to keep the existing PO calculation.
                          </p>
                        ) : null}
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
