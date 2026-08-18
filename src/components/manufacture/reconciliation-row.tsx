"use client";

// One line item on the reconciliation grid: what we measured, the allowance
// applied to it, and what the vendor is being told to build — three columns,
// left to right, so the arithmetic reads as a sentence.
//
// The allowance and the manufacturing figure are two views of ONE number
// (mfg = source + delta). Either is editable and the other follows. Editing
// them is free: no reason is demanded, because with an editable delta every
// manufacturing figure is reachable that way anyway, so requiring one would be
// friction that buys nothing. A reason can still be given and is still stored.
//
// Split out of reconciliation.tsx because the parent already carries the draft
// state, the summary and the confirm dialog; keeping the row here means neither
// file has to be read in full to change the other.

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

/** What a person has typed into one row. Seeded from the computed candidate. */
export type RowDraft = {
  width: string;
  height: string;
  widthDelta: string;
  heightDelta: string;
  reason: string;
};

export type RowState = {
  widthCm: number | null;
  heightCm: number | null;
  widthOverridden: boolean;
  heightOverridden: boolean;
  overridden: boolean;
  /** Recomputed against the source, so the figure shown always reconciles. */
  widthDeltaCm: number | null;
  heightDeltaCm: number | null;
  errors: string[];
};

export function draftFor(line: ReconLine): RowDraft {
  return {
    width: String(line.mfgWidthCm),
    height: String(line.mfgHeightCm),
    widthDelta: String(line.mfgWidthCm - line.sourceWidthCm),
    heightDelta: String(line.mfgHeightCm - line.sourceHeightCm),
    reason: "",
  };
}

// Whole positive centimetres only, matching manufactureLineSchema. Rejecting
// the string rather than coercing it means "29 8" or "298.5" surfaces as an
// error the person can see, instead of quietly becoming 298.
export function parseCm(s: string): number | null {
  const t = s.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

// A delta may be negative, zero, or positive — the sign is the whole point.
// Returns null for anything unparseable, including a lone "-" mid-typing, so
// the caller can leave the paired field alone rather than blanking it.
export function parseDelta(s: string): number | null {
  const t = s.trim();
  if (!/^-?\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isSafeInteger(n) ? n : null;
}

/** The delta implied by a typed manufacturing size. "" when it does not parse. */
export function deltaFromSize(size: string, sourceCm: number): string | null {
  const n = parseCm(size);
  return n == null ? null : String(n - sourceCm);
}

/** The manufacturing size implied by a typed delta. null when it does not parse. */
export function sizeFromDelta(delta: string, sourceCm: number): string | null {
  const d = parseDelta(delta);
  return d == null ? null : String(sourceCm + d);
}

/**
 * Merge a keystroke into a row's draft, keeping the allowance and the
 * manufacturing figure in step.
 *
 * They are two views of one number (mfg = source + delta), so whichever the
 * person typed wins and the other follows. When what they typed does not parse
 * yet — a lone "-" part-way through typing "-12" — the paired field is left
 * alone rather than blanked out from under them.
 *
 * Pure and exported so it can be tested: this is the arithmetic that decides
 * what gets cut, and it lives in a "use client" module where nothing else can
 * reach it.
 */
export function syncDraft(
  line: Pick<ReconLine, "sourceWidthCm" | "sourceHeightCm">,
  current: RowDraft,
  next: Partial<RowDraft>,
): RowDraft {
  const merged = { ...current, ...next };

  if (next.width !== undefined) {
    const delta = deltaFromSize(merged.width, line.sourceWidthCm);
    if (delta !== null) merged.widthDelta = delta;
  } else if (next.widthDelta !== undefined) {
    const size = sizeFromDelta(merged.widthDelta, line.sourceWidthCm);
    if (size !== null) merged.width = size;
  }

  if (next.height !== undefined) {
    const delta = deltaFromSize(merged.height, line.sourceHeightCm);
    if (delta !== null) merged.heightDelta = delta;
  } else if (next.heightDelta !== undefined) {
    const size = sizeFromDelta(merged.heightDelta, line.sourceHeightCm);
    if (size !== null) merged.height = size;
  }

  return merged;
}

function dimError(
  axis: "width" | "height",
  typed: string,
  computed: number,
): string {
  // Distinguish "the allowance produced something unbuildable" from "you
  // mistyped". The first is not the person's mistake and needs different
  // instructions.
  if (typed.trim() === String(computed) && computed <= 0) {
    return `The allowance takes this ${axis} to ${computed} cm, which cannot be manufactured. Change the allowance or the ${axis}.`;
  }
  return `Manufacturing ${axis} must be a whole number of centimetres above zero.`;
}

export function evaluateRow(line: ReconLine, draft: RowDraft): RowState {
  const widthCm = parseCm(draft.width);
  const heightCm = parseCm(draft.height);

  // "Adjusted" means "differs from what the configured allowance produced",
  // not "was typed in". Retyping 298 over a computed 298 is not an adjustment
  // and must not be flagged — nothing about the order changed.
  const widthOverridden = widthCm != null && widthCm !== line.mfgWidthCm;
  const heightOverridden = heightCm != null && heightCm !== line.mfgHeightCm;
  const overridden = widthOverridden || heightOverridden;

  const errors: string[] = [];
  if (widthCm == null) {
    errors.push(dimError("width", draft.width, line.mfgWidthCm));
  }
  if (heightCm == null) {
    errors.push(dimError("height", draft.height, line.mfgHeightCm));
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
  "px-2 py-1 border rounded text-sm text-right tabular-nums font-semibold " +
  "focus:outline-none focus:border-teal-500 disabled:bg-slate-50 disabled:text-slate-500";

function toneFor(invalid: boolean, adjusted: boolean): string {
  if (invalid) return "border-rose-400 bg-rose-50 text-rose-900";
  if (adjusted) return "border-amber-400 bg-amber-50 text-amber-900";
  return "border-slate-200 bg-white text-slate-900";
}

/**
 * One axis across all three columns.
 *
 * Rendered as `display: contents` on desktop so the six cells of a two-axis row
 * become direct children of ONE grid. That is what keeps Width and Height
 * aligned by construction — the previous flex-per-column layout let the two
 * rows size independently and drift apart whenever a value was wider.
 */
function AxisRow({
  axis,
  lineId,
  pieceLabel,
  sourceCm,
  size,
  delta,
  invalid,
  adjusted,
  disabled,
  onSize,
  onDelta,
}: {
  axis: "Width" | "Height";
  lineId: string;
  pieceLabel: string;
  sourceCm: number;
  size: string;
  delta: string;
  invalid: boolean;
  adjusted: boolean;
  disabled: boolean;
  onSize: (v: string) => void;
  onDelta: (v: string) => void;
}) {
  const lower = axis.toLowerCase();
  return (
    <div className="contents">
      <div className="flex items-center gap-2 min-w-0">
        <span className="w-14 shrink-0 text-xs text-slate-500">{axis}</span>
        <span className="text-sm text-slate-600 tabular-nums">
          {sourceCm} cm
        </span>
      </div>

      <div className="flex items-center gap-1.5">
        <span className="sm:hidden w-14 shrink-0 text-xs text-slate-500">
          Allowance
        </span>
        <input
          id={`${lineId}-${lower}-delta`}
          inputMode="numeric"
          aria-label={`${pieceLabel} ${lower} allowance in cm`}
          disabled={disabled}
          value={delta}
          onChange={(e) => onDelta(e.target.value)}
          className={`w-16 ${INPUT_BASE} ${toneFor(false, adjusted)}`}
        />
        <span className="text-xs text-slate-400">cm</span>
      </div>

      <div className="flex items-center gap-1.5">
        <span className="sm:hidden w-14 shrink-0 text-xs text-slate-500">
          Make
        </span>
        <input
          id={`${lineId}-${lower}`}
          inputMode="numeric"
          aria-label={`${pieceLabel} manufacturing ${lower} in cm`}
          aria-invalid={invalid}
          disabled={disabled}
          value={size}
          onChange={(e) => onSize(e.target.value)}
          className={`w-20 ${INPUT_BASE} ${toneFor(invalid, adjusted)}`}
        />
        <span className="text-xs text-slate-400">cm</span>
      </div>
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
  const piece = `${roomLabel} ${line.label}`;

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
            Adjusted
          </span>
        )}
      </div>

      {/* One grid for both axes and all three columns, so Width and Height line
          up by construction rather than by two independent flex rows agreeing
          about their own widths. */}
      <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto_auto] gap-x-4 gap-y-2 sm:items-center">
        <AxisRow
          axis="Width"
          lineId={line.lineId}
          pieceLabel={piece}
          sourceCm={line.sourceWidthCm}
          size={draft.width}
          delta={draft.widthDelta}
          invalid={state.widthCm == null}
          adjusted={state.widthOverridden}
          disabled={disabled}
          onSize={(width) => onChange({ width })}
          onDelta={(widthDelta) => onChange({ widthDelta })}
        />
        <AxisRow
          axis="Height"
          lineId={line.lineId}
          pieceLabel={piece}
          sourceCm={line.sourceHeightCm}
          size={draft.height}
          delta={draft.heightDelta}
          invalid={state.heightCm == null}
          adjusted={state.heightOverridden}
          disabled={disabled}
          onSize={(height) => onChange({ height })}
          onDelta={(heightDelta) => onChange({ heightDelta })}
        />
      </div>

      {state.overridden && (
        <div className="mt-3">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
            <label
              htmlFor={`${line.lineId}-reason`}
              className="text-xs font-medium text-amber-900"
            >
              Why? (optional — goes on the record)
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
