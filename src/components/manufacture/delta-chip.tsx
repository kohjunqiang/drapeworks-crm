// The one thing this whole screen exists to make visible: that the number the
// vendor is given is not the number we measured.
//
// No "use client" — a pure presentational fragment, so both the editable
// reconciliation grid and the read-only frozen view render deltas identically.

// A true Unicode minus when READING. A hyphen at 11px is easy to lose, and
// losing it here means a vendor is told to build the piece bigger than the
// opening. Inputs elsewhere stay plain ASCII so typing is never ambiguous.
export const MINUS = "−";

export function signedCm(n: number): string {
  return `${n < 0 ? MINUS : "+"}${Math.abs(n)} cm`;
}

/** Where the number came from: the allowance rule, or a person overriding it. */
export type DeltaSource = "rule" | "person";

const TONES: Record<DeltaSource, string> = {
  rule: "border-teal-300 bg-teal-50 text-teal-800",
  person: "border-amber-400 bg-amber-100 text-amber-900",
};

const TITLES: Record<DeltaSource, string> = {
  rule: "Difference from the measured opening, from the manufacturing allowance",
  person: "Difference from the measured opening, set by hand",
};

/**
 * A zero delta renders NOTHING, on purpose.
 *
 * The chip's whole meaning is "this changed". Showing "0 cm" everywhere would
 * make it furniture, and a reader would stop seeing the ones that matter.
 */
export function DeltaChip({
  delta,
  source = "rule",
}: {
  delta: number | null;
  source?: DeltaSource;
}) {
  if (delta == null || delta === 0) return null;
  return (
    <span
      title={TITLES[source]}
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-xs font-semibold tabular-nums whitespace-nowrap ${TONES[source]}`}
    >
      {signedCm(delta)}
    </span>
  );
}
