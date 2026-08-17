"use client";

// One line item on the reconciliation grid: what we measured, beside what the
// vendor is being told to build.
//
// Split out of reconciliation.tsx because the parent already carries the draft
// state, the summary and the confirm dialog; keeping the row here means neither
// file has to be read in full to change the other.

import { DeltaChip } from "./delta-chip";

/** A line item with its computed manufacturing candidate, from the server. */
export type ReconLine = {
  lineId: string;
  kind: "window" | "mesh_panel";
  /** "Window 1" / "Panel 2" — position, made 1-based for a human. */
  label: string;
  /** Catalogue labels, verbatim. */
  description: string | null;
  sourceWidthCm: number;
  sourceHeightCm: number;
  /** The allowance applied. May be ≤ 0, which is a state a human must resolve. */
  mfgWidthCm: number;
  mfgHeightCm: number;
};

/** What a person has typed into one row. Seeded with the computed candidate. */
export type RowDraft = { width: string; height: string; reason: string };

export type RowState = {
  widthCm: number | null;
  heightCm: number | null;
  widthOverridden: boolean;
  heightOverridden: boolean;
  overridden: boolean;
  /** Recomputed against the source, so an overridden chip tells the truth. */
  widthDeltaCm: number | null;
  heightDeltaCm: number | null;
  errors: string[];
};

export function draftFor(line: ReconLine): RowDraft {
  return {
    width: String(line.mfgWidthCm),
    height: String(line.mfgHeightCm),
    reason: "",
  };
}

// Whole positive centimetres only, matching manufactureLineSchema. Rejecting
// the string rather than coercing it means "29 8" or "298.5" surfaces as an
// error the person can see, instead of quietly becoming 298.
function parseCm(s: string): number | null {
  const t = s.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function dimError(
  axis: "width" | "height",
  typed: string,
  computed: number,
): string {
  // Distinguish "the rule produced something unbuildable" from "you mistyped".
  // The first is not the person's mistake and needs different instructions.
  if (typed.trim() === String(computed) && computed <= 0) {
    return `The allowance takes this ${axis} to ${computed} cm, which cannot be manufactured. Type a ${axis} to override it, and say why.`;
  }
  return `Manufacturing ${axis} must be a whole number of centimetres above zero.`;
}

export function evaluateRow(line: ReconLine, draft: RowDraft): RowState {
  const widthCm = parseCm(draft.width);
  const heightCm = parseCm(draft.height);

  // Overridden means "differs from what the rule produced", not "was typed in".
  // Retyping 298 over a computed 298 is not an override and must not demand a
  // reason — nothing about the order changed.
  const widthOverridden = widthCm != null && widthCm !== line.mfgWidthCm;
  const heightOverridden = heightCm != null && heightCm !== line.mfgHeightCm;
  const overridden = widthOverridden || heightOverridden;

  const errors: string[] = [];
  if (widthCm == null) errors.push(dimError("width", draft.width, line.mfgWidthCm));
  if (heightCm == null) {
    errors.push(dimError("height", draft.height, line.mfgHeightCm));
  }
  if (overridden && draft.reason.trim() === "") {
    errors.push("Say why this measurement was changed.");
  }

  return {
    widthCm,
    heightCm,
    widthOverridden,
    heightOverridden,
    overridden,
    widthDeltaCm: widthCm == null ? null : widthCm - line.sourceWidthCm,
    heightDeltaCm: heightCm == null ? null : heightCm - line.sourceHeightCm,
    errors,
  };
}

const INPUT_BASE =
  "w-20 px-2 py-1 border rounded text-sm text-right tabular-nums font-semibold " +
  "focus:outline-none focus:border-teal-500 disabled:bg-slate-50 disabled:text-slate-500";

function MeasuredRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="w-14 shrink-0 text-xs text-slate-500">{label}</span>
      <span className="text-sm text-slate-600 tabular-nums">{value} cm</span>
    </div>
  );
}

function ManufactureRow({
  id,
  label,
  value,
  invalid,
  overridden,
  delta,
  disabled,
  onChange,
  pieceLabel,
}: {
  id: string;
  label: string;
  value: string;
  invalid: boolean;
  overridden: boolean;
  delta: number | null;
  disabled: boolean;
  onChange: (v: string) => void;
  /** Which piece this input belongs to, e.g. "Living Room Window 1". The
   *  visible label is just "Width", so on a twenty-window order a screen
   *  reader would otherwise announce forty controls called "Width" or
   *  "Height" with nothing to tell them apart. */
  pieceLabel: string;
}) {
  const border = invalid
    ? "border-rose-400 bg-rose-50 text-rose-900"
    : overridden
      ? "border-amber-400 bg-amber-50 text-amber-900"
      : "border-slate-200 bg-white text-slate-900";
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <label htmlFor={id} className="w-14 shrink-0 text-xs text-slate-500">
        {label}
      </label>
      <input
        id={id}
        inputMode="numeric"
        aria-label={`${pieceLabel} manufacturing ${label.toLowerCase()} in cm`}
        aria-invalid={invalid}
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${INPUT_BASE} ${border}`}
      />
      <span className="text-xs text-slate-400">cm</span>
      <DeltaChip delta={delta} source={overridden ? "person" : "rule"} />
    </div>
  );
}

export function ReconciliationRow({
  line,
  roomLabel,
  draft,
  state,
  disabled,
  onChange,
  onReset,
}: {
  line: ReconLine;
  /** Only used for the inputs' accessible names. `line.label` is "Window 1",
   *  which repeats in every room — the room is what tells them apart. */
  roomLabel: string;
  draft: RowDraft;
  state: RowState;
  disabled: boolean;
  onChange: (patch: Partial<RowDraft>) => void;
  onReset: () => void;
}) {
  const tone =
    state.errors.length > 0
      ? "bg-rose-50/60"
      : state.overridden
        ? "bg-amber-50/50"
        : "";

  return (
    <div className={`border-t border-slate-100 px-4 py-3 ${tone}`}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 mb-2">
        <span className="text-sm font-semibold text-slate-900">
          {line.label}
        </span>
        {line.description && (
          <span className="text-xs text-slate-500 break-words">
            {line.description}
          </span>
        )}
        {state.overridden && (
          <span className="inline-flex items-center rounded bg-amber-100 border border-amber-300 px-1.5 py-0.5 text-[11px] font-medium text-amber-900">
            Set by hand
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          {/* Repeated per row on mobile only: once the columns stack, a header
              200px up the page no longer says which block is which. */}
          <div className="sm:hidden mb-1 text-[11px] uppercase tracking-wide text-slate-400">
            Measured
          </div>
          <div className="space-y-1">
            <MeasuredRow label="Width" value={line.sourceWidthCm} />
            <MeasuredRow label="Height" value={line.sourceHeightCm} />
          </div>
        </div>

        <div className="sm:pl-4 sm:border-l sm:border-slate-200">
          <div className="sm:hidden mb-1 text-[11px] uppercase tracking-wide text-slate-400">
            To manufacture
          </div>
          <div className="space-y-1">
            <ManufactureRow
              id={`${line.lineId}-w`}
              label="Width"
              pieceLabel={`${roomLabel} ${line.label}`}
              value={draft.width}
              invalid={state.widthCm == null}
              overridden={state.widthOverridden}
              delta={state.widthDeltaCm}
              disabled={disabled}
              onChange={(width) => onChange({ width })}
            />
            <ManufactureRow
              id={`${line.lineId}-h`}
              label="Height"
              pieceLabel={`${roomLabel} ${line.label}`}
              value={draft.height}
              invalid={state.heightCm == null}
              overridden={state.heightOverridden}
              delta={state.heightDeltaCm}
              disabled={disabled}
              onChange={(height) => onChange({ height })}
            />
          </div>
        </div>
      </div>

      {state.overridden && (
        <div className="mt-3 sm:pl-[calc(50%+0.375rem)]">
          <div className="flex items-center justify-between gap-2 mb-1">
            <label
              htmlFor={`${line.lineId}-reason`}
              className="text-xs font-medium text-amber-900"
            >
              Why was this changed? (required)
            </label>
            <button
              type="button"
              onClick={onReset}
              disabled={disabled}
              className="text-xs text-slate-500 hover:text-slate-900 underline underline-offset-2"
            >
              Reset to {line.mfgWidthCm} × {line.mfgHeightCm} cm
            </button>
          </div>
          <textarea
            id={`${line.lineId}-reason`}
            rows={2}
            maxLength={500}
            disabled={disabled}
            value={draft.reason}
            onChange={(e) => onChange({ reason: e.target.value })}
            placeholder="e.g. site re-measure — the ledge is 4cm proud of the wall"
            className="w-full px-3 py-2 border border-amber-300 rounded text-sm bg-white focus:outline-none focus:border-amber-500"
          />
        </div>
      )}

      {state.errors.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-rose-700">
          {state.errors.map((e) => (
            <li key={e}>⚠ {e}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
