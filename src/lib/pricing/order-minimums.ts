/** Customer-facing minimums, in SGD cents. */
export const CURTAINS_AND_BLINDS_ORDER_MINIMUM_SGD_CENTS = 50_000;
export const VENETIAN_BLIND_MINIMUM_SGD_CENTS = 30_000;

const normaliseName = (name: string): string =>
  name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");

/** A Venetian blind starts at S$300 before any add-ons. */
export function blindMinimumSgdCents(seriesName: string | null | undefined): number {
  return normaliseName(seriesName ?? "").includes("venetian")
    ? VENETIAN_BLIND_MINIMUM_SGD_CENTS
    : 0;
}

/**
 * Minimum for an order containing this mesh category. Variant names such as
 * "AirGuard 2-in-1" inherit the base family's minimum. Mixed orders use the
 * highest category minimum in the mesh calculator.
 */
export function meshCategoryMinimumSgdCents(
  categoryName: string | null | undefined,
): number {
  const name = normaliseName(categoryName ?? "");
  if (name.includes("maxguard")) return 65_000;
  if (name.includes("homeguard")) return 60_000;
  if (name.includes("airguard")) return 55_000;
  return 0;
}
