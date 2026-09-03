export type DoubleDrawSplit = { leftCm: number; rightCm: number };

/**
 * Carry a measured left/right allocation onto a different total width.
 * The rounded sides always add back to the manufacturing width, so the PO
 * cannot contradict the total width printed beside the split.
 */
export function scaleDoubleDrawSplit(
  manufacturingWidthCm: number,
  measuredLeftCm: number | null | undefined,
  measuredRightCm: number | null | undefined,
): DoubleDrawSplit | null {
  if (
    measuredLeftCm == null ||
    measuredRightCm == null ||
    measuredLeftCm <= 0 ||
    measuredRightCm <= 0 ||
    manufacturingWidthCm <= 0
  ) {
    return null;
  }

  const measuredTotal = measuredLeftCm + measuredRightCm;
  const leftCm = Math.round(
    (manufacturingWidthCm * measuredLeftCm) / measuredTotal,
  );
  return { leftCm, rightCm: manufacturingWidthCm - leftCm };
}
