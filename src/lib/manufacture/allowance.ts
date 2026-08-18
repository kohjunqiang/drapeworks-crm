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
    mfgWidthCm: widthCm + allowance.widthDeltaCm,
    mfgHeightCm: heightCm + allowance.heightDeltaCm,
  };
}

// A vendor cannot build a panel with a dimension of zero or less.
export function isManufacturable(a: AppliedAllowance): boolean {
  return a.mfgWidthCm > 0 && a.mfgHeightCm > 0;
}
