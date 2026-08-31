export type PackageAdjustmentDirection = "charge" | "credit";
export type PackageAdjustmentBasis = "whole_package" | "per_room" | "per_metre";

export type PackageAdjustmentInput = {
  key: string;
  label: string;
  direction: PackageAdjustmentDirection;
  basis: PackageAdjustmentBasis;
  amountSgdCents: number;
  /** Required for per-room adjustments; ignored for whole-package lines. */
  roomCount?: number;
  /** Required for per-metre adjustments; measured selling width, never COGS width. */
  widthCm?: number;
};

export type PackagePriceLine = {
  key: string;
  label: string;
  quantity: number;
  unitSgdCents: number;
  totalSgdCents: number;
};

export type PackageQuote = {
  totalSgdCents: number;
  lines: PackagePriceLine[];
};

function positiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
}

/**
 * Selling-price arithmetic shared by live and saved package quotes.
 *
 * The package is always the first line. Adjustments can add or subtract from
 * it, but none can replace the accumulated total. That invariant prevents the
 * old combo loophole where applying a fixed price erased chargeable add-ons.
 */
export function computePackageQuote(
  baseLabel: string,
  basePriceSgdCents: number,
  adjustments: readonly PackageAdjustmentInput[],
): PackageQuote {
  positiveInteger(basePriceSgdCents, "Base package price");

  const lines: PackagePriceLine[] = [
    {
      key: "base_package",
      label: baseLabel,
      quantity: 1,
      unitSgdCents: basePriceSgdCents,
      totalSgdCents: basePriceSgdCents,
    },
  ];

  for (const adjustment of adjustments) {
    positiveInteger(adjustment.amountSgdCents, `${adjustment.label} amount`);
    let quantity: number;
    if (adjustment.basis === "whole_package") {
      quantity = 1;
    } else if (adjustment.basis === "per_room") {
      if (adjustment.roomCount == null) {
        throw new Error(`${adjustment.label} requires a room count`);
      }
      quantity = adjustment.roomCount;
      positiveInteger(quantity, `${adjustment.label} room count`);
    } else {
      if (adjustment.widthCm == null) {
        throw new Error(`${adjustment.label} requires a measured width`);
      }
      const widthCm = adjustment.widthCm;
      positiveInteger(widthCm, `${adjustment.label} width`);
      quantity = widthCm / 100;
    }

    const unsigned = Math.round(quantity * adjustment.amountSgdCents);
    const total = adjustment.direction === "credit" ? -unsigned : unsigned;
    lines.push({
      key: adjustment.key,
      label: adjustment.label,
      quantity,
      unitSgdCents: adjustment.amountSgdCents,
      totalSgdCents: total,
    });
  }

  const totalSgdCents = lines.reduce((sum, line) => sum + line.totalSgdCents, 0);
  if (totalSgdCents < 0) {
    throw new Error("Package credits cannot exceed the package and upgrade charges");
  }
  return { totalSgdCents, lines };
}
