// The presentation half of `CogsLine` — kept out of the calculators so pricing
// stays free of labels, and shared by all three cost-breakdown surfaces (the
// curtain live quote, the mesh live quote, and the saved-order quote card) so
// the same component is named the same thing everywhere.

import type { CogsKey, CogsLine } from "./calculator";

export const COGS_LABELS: Record<CogsKey, string> = {
  curtains: "Curtains",
  blinds: "Blinds",
  s_fold: "S-Fold",
  slim_tracks: "Slim tracks",
  // Spelled out because it surprises people: the rail is a cost we absorb, so
  // it sits in COGS while never appearing on the customer's quote.
  track: "Track (rail, cost only)",
  mesh: "Mesh panels",
  colour: "Colour surcharge",
  double_draw: "Double-draw hardware",
};

/**
 * The rows worth showing: a component that costs nothing is noise, not
 * information — no S-Fold was ordered, so no S-Fold line.
 *
 * When every component is zero the first is kept regardless, so the China-costs
 * section never renders as a headless list of freight and tax. That happens for
 * real: a mesh category priced for sale but with no cost configured quotes the
 * customer correctly and reports zero COGS.
 */
export function visibleCogsLines(lines: CogsLine[]): CogsLine[] {
  const nonZero = lines.filter((l) => l.rmbCents !== 0);
  return nonZero.length > 0 ? nonZero : lines.slice(0, 1);
}
