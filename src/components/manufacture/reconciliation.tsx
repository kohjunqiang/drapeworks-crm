"use client";

// The reconciliation grid: what the consultant measured, beside what the vendor
// is being told to build, with every difference labelled.
//
// This is the last screen before the goods are cut, so the bias throughout is
// towards making a change impossible to miss rather than towards a tidy table.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { confirmManufactureMeasurements } from "@/lib/actions/manufacture";

import {
  ReconciliationRow,
  draftFor,
  evaluateRow,
  type ReconLine,
  type RowDraft,
} from "./reconciliation-row";

export type { ReconLine } from "./reconciliation-row";

export type ReconRoom = { roomId: string; label: string; lines: ReconLine[] };

// "18 windows", "4 panels", or "12 items" for an order that somehow has both.
function countNoun(lines: ReconLine[]): string {
  const n = lines.length;
  const allWindows = lines.every((l) => l.kind === "window");
  const allPanels = lines.every((l) => l.kind === "mesh_panel");
  const noun = allWindows ? "window" : allPanels ? "panel" : "item";
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

export function Reconciliation({
  orderId,
  rooms,
}: {
  orderId: string;
  rooms: ReconRoom[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  const lines = useMemo(() => rooms.flatMap((r) => r.lines), [rooms]);

  const [drafts, setDrafts] = useState<Record<string, RowDraft>>(() =>
    Object.fromEntries(lines.map((l) => [l.lineId, draftFor(l)])),
  );

  // Every row is evaluated together so the footer can count errors and
  // overrides from exactly the same reading the rows render from.
  const states = useMemo(
    () =>
      new Map(
        lines.map((l) => [
          l.lineId,
          evaluateRow(l, drafts[l.lineId] ?? draftFor(l)),
        ]),
      ),
    [lines, drafts],
  );

  const overriddenCount = [...states.values()].filter((s) => s.overridden).length;
  const errorCount = [...states.values()].filter(
    (s) => s.errors.length > 0,
  ).length;
  // Null deltas mean the field does not currently parse; such a row is counted
  // under "to fix", not under "resized", or an unreadable number would be
  // reported as a difference nobody can see on the row.
  const resizedCount = [...states.values()].filter(
    (s) =>
      !s.overridden &&
      s.widthDeltaCm != null &&
      s.heightDeltaCm != null &&
      (s.widthDeltaCm !== 0 || s.heightDeltaCm !== 0),
  ).length;
  const canConfirm = errorCount === 0 && lines.length > 0 && !pending;

  function patch(lineId: string, next: Partial<RowDraft>) {
    setDrafts((d) => ({ ...d, [lineId]: { ...d[lineId], ...next } }));
  }

  function reset(line: ReconLine) {
    setDrafts((d) => ({ ...d, [line.lineId]: draftFor(line) }));
  }

  function submit() {
    // One entry per line, ALWAYS — the action rejects a payload whose line set
    // does not match the order's exactly, because a missing id would be
    // manufactured at its default without anyone having looked at it.
    //
    // Only what a person typed is sent. Deltas and defaulted dimensions are
    // deliberately absent: the server recomputes them from the allowance table,
    // and arithmetic that arrives from a browser is arithmetic nobody can
    // vouch for.
    const payload = lines.map((line) => {
      const s = states.get(line.lineId)!;
      return {
        lineId: line.lineId,
        kind: line.kind,
        overrideWidthCm: s.widthOverridden ? s.widthCm : undefined,
        overrideHeightCm: s.heightOverridden ? s.heightCm : undefined,
        overrideReason: s.overridden
          ? (drafts[line.lineId]?.reason.trim() ?? "")
          : undefined,
      };
    });

    startTransition(async () => {
      try {
        await confirmManufactureMeasurements({ orderId, lines: payload });
        toast.success("Manufacturing measurements confirmed");
        setOpen(false);
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not confirm");
      }
    });
  }

  return (
    <>
      <div className="space-y-3 pb-4">
        {rooms.map((room) => (
          <div
            key={room.roomId}
            className="border border-slate-200 rounded overflow-hidden bg-white"
          >
            <div className="bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-800 break-words">
              {room.label}
            </div>
            {/* Column headers live at the room level on desktop; each row
                repeats them on mobile, where the two columns stack. */}
            <div className="hidden sm:grid grid-cols-2 gap-3 px-4 py-1.5 border-t border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
              <div>Measured</div>
              <div className="pl-4">To manufacture</div>
            </div>
            {room.lines.map((line) => (
              <ReconciliationRow
                key={line.lineId}
                line={line}
                draft={drafts[line.lineId] ?? draftFor(line)}
                state={states.get(line.lineId)!}
                disabled={pending}
                onChange={(next) => patch(line.lineId, next)}
                onReset={() => reset(line)}
              />
            ))}
          </div>
        ))}
      </div>

      <div className="sticky bottom-0 z-10 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 bg-white/95 backdrop-blur border-t border-slate-200">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-slate-600">
            <span className="font-medium text-slate-900">
              {countNoun(lines)}
            </span>
            {resizedCount > 0 && (
              <>
                {" · "}
                <span className="text-teal-800">
                  {resizedCount} resized by the allowance
                </span>
              </>
            )}
            {overriddenCount > 0 && (
              <>
                {" · "}
                <span className="font-medium text-amber-900">
                  {overriddenCount} overridden
                </span>
              </>
            )}
            {errorCount > 0 && (
              <>
                {" · "}
                <span className="font-medium text-rose-700">
                  {errorCount} to fix
                </span>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={() => setOpen(true)}
            disabled={!canConfirm}
            className="px-4 py-2 text-sm bg-teal-600 hover:bg-teal-700 disabled:bg-slate-300 text-white rounded font-medium"
          >
            {pending ? "Confirming…" : "Confirm manufacturing measurements"}
          </button>
        </div>
        {errorCount > 0 && (
          <p className="mt-2 text-xs text-rose-700">
            Fix the {errorCount === 1 ? "row" : "rows"} marked above before
            confirming.
          </p>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Confirm manufacturing measurements</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm text-slate-700">
            <p>
              You are about to commit {countNoun(lines)}
              {overriddenCount > 0 && (
                <>
                  , <span className="font-medium">{overriddenCount}</span> of
                  them set by hand
                </>
              )}
              . This will:
            </p>
            <ul className="list-disc pl-5 space-y-1 text-slate-700">
              <li>
                <span className="font-medium">Freeze these dimensions</span> for
                the rest of the order — later allowance changes will not move
                them.
              </li>
              <li>
                <span className="font-medium">Lock the order</span> from further
                editing.
              </li>
              <li>
                Move it to{" "}
                <span className="font-medium">Sent to Vendor</span>.
              </li>
            </ul>
            <p className="text-xs text-slate-500">
              Only an admin can amend the measurements afterwards, and every
              amendment is recorded on the order timeline.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={pending}
                className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-900"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={pending}
                className="px-4 py-1.5 text-sm bg-teal-600 hover:bg-teal-700 disabled:bg-slate-300 text-white rounded font-medium"
              >
                {pending ? "Confirming…" : "Confirm and send to vendor"}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
