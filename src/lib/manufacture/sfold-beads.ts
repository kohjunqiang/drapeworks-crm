import type { DrawDirection } from "@/lib/db/schema";

// S-fold bead (走珠) counts — the runner count the vendor cuts the track to.
//
// Pure on purpose: the reconciliation screen seeds its draft from this, and
// the confirm action re-derives the same default from the same facts, so the
// number shown and the number frozen can never drift apart.
//
// The default is derived from the MEASURED width, never the manufacturing
// width: runners space the curtain as sewn, and the bead count is a property
// of the opening the fabric must cover — a −2 cm hem allowance must not move
// it. Editing the allowance therefore never recalculates the beads.

export const MAX_BEAD_COUNT = 2_147_483_646;

/** Beads space at 6 cm per side and are supplied in even counts per leaf. */
export function beadsForWidth(widthCm: number): number {
  return Math.ceil(widthCm / 12) * 2;
}

/** The bead shape a window's draw demands: one count per leaf. */
export function beadShapeFor(
  draw: DrawDirection | null,
): "single" | "pair" {
  return draw === "Double" ? "pair" : "single";
}

export type SFoldBeads =
  | { kind: "single"; count: number }
  | { kind: "pair"; left: number; right: number };

/**
 * The default bead counts for one S-fold window, from its measured facts.
 *
 * A double draw gets a count per leaf: the measured split when one was taken
 * on site, or an even halving of the measured width otherwise.
 */
export function defaultBeads(line: {
  draw: DrawDirection | null;
  widthCm: number;
  splitLeftCm?: number | null;
  splitRightCm?: number | null;
}): SFoldBeads {
  if (beadShapeFor(line.draw) === "single") {
    return { kind: "single", count: beadsForWidth(line.widthCm) };
  }
  const hasSplit =
    line.splitLeftCm != null &&
    line.splitRightCm != null &&
    line.splitLeftCm > 0 &&
    line.splitRightCm > 0;
  return {
    kind: "pair",
    left: beadsForWidth(hasSplit ? line.splitLeftCm! : line.widthCm / 2),
    right: beadsForWidth(hasSplit ? line.splitRightCm! : line.widthCm / 2),
  };
}

/** A whole, positive, even count — or null for anything else, including "". */
export function parseBeadCount(s: string): number | null {
  const t = s.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isSafeInteger(n) && n > 0 && n <= MAX_BEAD_COUNT && n % 2 === 0 ? n : null;
}
