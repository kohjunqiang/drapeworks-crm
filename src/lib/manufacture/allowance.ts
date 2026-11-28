import {
  CURTAIN_HEIGHT_DELTA_CM,
  type CurtainHeightPreference,
} from "@/lib/curtain-height-preference";
import type { CurtainProductLine } from "@/lib/db/schema";

// The three lines an allowance can be configured for. Curtains and blinds are
// the two curtain_series product lines; mesh is its own product.
export type AllowanceLine = CurtainProductLine | "mesh";

export type Allowance = {
  widthDeltaCm: number;
  heightDeltaCm: number;
};

// null means UNCONFIGURED. A configured allowance of 0/0 is a real answer
// ("manufacture at the measured size") and must not be confused with it.
export type AllowanceBook = Record<AllowanceLine, Allowance | null>;

export function resolveAllowance(
  book: AllowanceBook,
  line: AllowanceLine,
): Allowance | null {
  return book[line] ?? null;
}

export type LineAllowance = {
  /** The allowance to apply — height delta already substituted when a preference governs it. */
  allowance: Allowance;
  /** What produced the height delta: the window's saved drop, or the configured allowance. */
  heightSource: "preference" | "configured";
  heightPreference: CurtainHeightPreference | null;
};

/**
 * The allowance a line item actually manufactures to.
 *
 * A saved curtain height preference REPLACES the configured curtain height
 * delta — manufacturing height is measured + preference, never
 * measured + allowance + preference. Width is untouched, and so are blinds
 * and mesh: a preference only exists on a curtain window. A null preference
 * (any window saved before the field) keeps the configured delta verbatim, so
 * the three call sites — the reconciliation screen, the precondition check
 * and the confirm action — all see the same effective allowance.
 */
export function effectiveAllowance(
  line: AllowanceLine,
  heightPreference: CurtainHeightPreference | null | undefined,
  allowance: Allowance,
): LineAllowance {
  const preference =
    line === "curtain" ? (heightPreference ?? null) : null;
  if (preference == null) {
    return { allowance, heightSource: "configured", heightPreference: null };
  }
  return {
    allowance: {
      widthDeltaCm: allowance.widthDeltaCm,
      heightDeltaCm: CURTAIN_HEIGHT_DELTA_CM[preference],
    },
    heightSource: "preference",
    heightPreference: preference,
  };
}

export type SourceDims = {
  widthCm: number | null;
  heightCm: number | null;
};

export type AppliedAllowance = {
  sourceWidthCm: number;
  sourceHeightCm: number;
  widthDeltaCm: number;
  heightDeltaCm: number;
  mfgWidthCm: number;
  mfgHeightCm: number;
};

/**
 * Apply an allowance to a measured opening.
 *
 * Returns null when the opening was never measured — that is a data problem
 * upstream, not an arithmetic one. When the opening IS measured, the result is
 * always returned even if the allowance swallows it, so the caller can show a
 * human the impossible number rather than silently clamping it. Use
 * `isManufacturable` to gate on that.
 */
export function applyAllowance(
  dims: SourceDims,
  allowance: Allowance,
): AppliedAllowance | null {
  const { widthCm, heightCm } = dims;
  if (widthCm == null || heightCm == null) return null;
  if (widthCm <= 0 || heightCm <= 0) return null;

  return {
    sourceWidthCm: widthCm,
    sourceHeightCm: heightCm,
    widthDeltaCm: allowance.widthDeltaCm,
    heightDeltaCm: allowance.heightDeltaCm,
    mfgWidthCm: Math.round((widthCm + allowance.widthDeltaCm) * 100) / 100,
    mfgHeightCm: Math.round((heightCm + allowance.heightDeltaCm) * 100) / 100,
  };
}

// A vendor cannot build a panel with a dimension of zero or less.
export function isManufacturable(a: AppliedAllowance): boolean {
  return a.mfgWidthCm > 0 && a.mfgHeightCm > 0;
}

/**
 * Track-only rails: only the width is procured. A measured height still gets
 * the height allowance applied; an unmeasured one is stored as 0 ("no height
 * to cut") rather than fabricated, and never blocks confirmation.
 */
export function applyTrackAllowance(
  dims: SourceDims,
  allowance: Allowance,
): AppliedAllowance | null {
  const { widthCm, heightCm } = dims;
  if (widthCm == null || widthCm <= 0) return null;
  const hasHeight = heightCm != null && heightCm > 0;

  return {
    sourceWidthCm: widthCm,
    sourceHeightCm: hasHeight ? heightCm : 0,
    widthDeltaCm: allowance.widthDeltaCm,
    heightDeltaCm: hasHeight ? allowance.heightDeltaCm : 0,
    mfgWidthCm: Math.round((widthCm + allowance.widthDeltaCm) * 100) / 100,
    mfgHeightCm: hasHeight
      ? Math.round((heightCm + allowance.heightDeltaCm) * 100) / 100
      : 0,
  };
}
