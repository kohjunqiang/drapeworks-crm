// One saved curtain drop per curtain window, shared by the day and night
// curtains on it — a window is one covering. The choices are mutually
// exclusive; each maps to a signed centimetre delta applied to the MEASURED
// height. At manufacturing time the preference REPLACES the configured
// curtain height allowance — "Cover track" is its own −2 cm, never an extra
// −2 cm stacked on "Touch" or on the allowance.
//
// NULL is meaningful: a window saved before this field existed keeps the
// configured allowance, so historic dimensions are never silently re-derived.
// The same keys are stored on manufacture_measurements at confirmation so a
// frozen row still explains where its height came from.

export const CURTAIN_HEIGHT_PREFERENCES = [
  "default",
  "touch",
  "sweep",
  "more_sweep",
  "cover_track",
] as const;

export type CurtainHeightPreference =
  (typeof CURTAIN_HEIGHT_PREFERENCES)[number];

export const CURTAIN_HEIGHT_DELTA_CM: Record<
  CurtainHeightPreference,
  number
> = {
  default: -4,
  touch: -2,
  sweep: 0,
  more_sweep: 2,
  cover_track: -2,
};

// "Touch" and "Cover track" share a delta on purpose — they are different
// instructions, and their labels must never collapse into one.
export const CURTAIN_HEIGHT_LABELS: Record<
  CurtainHeightPreference,
  string
> = {
  default: "Default",
  touch: "Touch",
  sweep: "Sweep",
  more_sweep: "More sweep",
  cover_track: "Cover track",
};

// What a NULL preference falls back to: whatever Product → Allowances says
// for the line. Named, not blank, so a legacy window never reads as a silent
// change to its historic dimensions.
export const STANDARD_ALLOWANCE_LABEL = "Standard allowance";

// A true Unicode minus when READING, matching delta-chip.tsx.
const MINUS = "−";

export function signedCmDelta(deltaCm: number): string {
  if (deltaCm === 0) return "0 cm";
  return `${deltaCm < 0 ? MINUS : "+"}${Math.abs(deltaCm)} cm`;
}

/** "Touch (−2 cm)" — the label shown beside the preference wherever it appears. */
export function curtainHeightOptionLabel(
  preference: CurtainHeightPreference,
): string {
  return `${CURTAIN_HEIGHT_LABELS[preference]} (${signedCmDelta(CURTAIN_HEIGHT_DELTA_CM[preference])})`;
}

/** "Standard allowance (−8 cm)" — a legacy window's height basis. */
export function standardAllowanceLabel(deltaCm: number): string {
  return `${STANDARD_ALLOWANCE_LABEL} (${signedCmDelta(deltaCm)})`;
}

/**
 * "Recorded adjustment (−3 cm)" — a FROZEN row with no snapshotted drop whose
 * stored delta was typed by hand. The stored value may not match the
 * configured allowance, so calling it "Standard allowance" would be a lie
 * about history.
 */
export function recordedAdjustmentLabel(deltaCm: number): string {
  return `Recorded adjustment (${signedCmDelta(deltaCm)})`;
}
