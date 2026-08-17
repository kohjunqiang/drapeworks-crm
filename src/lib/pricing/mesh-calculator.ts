// Mesh pricing — the product-specific front end for window mesh panels.
//
// Where curtains price by width × a per-metre rate, mesh prices BY AREA: the
// panel's area in square feet × the category's per-ft² rate, plus the colour's
// flat surcharge. Everything downstream — freight, other cost, GST, RMB→SGD,
// install, the order discount, margin, groupbuy — is shared with curtains via
// finaliseQuote.
//
// Money is integer cents throughout (RMB cost cents, SGD sale cents), and rates
// are integer cents per ft² (S$8.00/ft² = 800). Area is integer cm², converted
// to ft² only inside the one rounding step below.
//
// See docs/specs/phase-11-mesh-product-line.md §6.

import {
  isDoubleDraw,
  resolveMeshSystem,
  type MeshSystemBand,
} from "@/lib/orders/mesh-system";
import type { MeshDraw } from "@/lib/validation/mesh";

import {
  finaliseQuote,
  type CalcAssumptions,
  type FreightMode,
  type QuoteResult,
} from "./calculator";

// Mesh adds one assumption to the shared set. It's kept as an intersection
// rather than folded into CalcAssumptions so the curtain calculator has no
// knowledge of mesh install costs.
export type MeshCalcAssumptions = CalcAssumptions & {
  handymanMeshSgdCents: number;
};

export type MeshPanel = {
  categoryId: string | null;
  colourId: string | null;
  widthCm: number | null;
  heightCm: number | null;
  /**
   * Needed by pricing, not just by the factory sheet: a double draw carries a
   * roller and handle on each leaf, and that extra hardware is charged as a
   * per-panel surcharge on the system it resolves to.
   */
  draw: MeshDraw | null;
};

export type MeshRate = {
  costRmbCentsPerSqft: number | null; // null = cost not configured (margin unreliable)
  saleSgdCentsPerSqft: number | null; // null = not yet priced
};

export type MeshColourSurcharge = {
  costRmbCents: number | null;
  saleSgdCents: number | null;
};

// Plain records rather than Maps so the whole book crosses the server→client
// boundary as props, the same way CalcConfig does.
export type MeshPriceBook = {
  rates: Record<string, MeshRate>; // key: categoryId
  colours: Record<string, MeshColourSurcharge>;
  /**
   * The track-system matrix, carried here only because a double draw's
   * surcharge is keyed on the system a panel resolves to. Pricing does not
   * otherwise care which system gets built.
   */
  bands: MeshSystemBand[];
  /** Per-panel double-draw surcharge, keyed by lower-cased system name. */
  doubleSurcharges: Record<string, MeshColourSurcharge>;
  /**
   * Minimum billable area PER LEAF in cm², keyed
   * `${categoryId}:${lower-cased system name}`. Absent = no minimum.
   */
  minimumAreas: Record<string, number>;
};

/** Key for the minimum-area grid. */
export const minimumKey = (categoryId: string, system: string): string =>
  `${categoryId}:${system.trim().toLowerCase()}`;

// 1 ft = 30.48 cm exactly, so 1 ft² = 929.0304 cm². Held as an integer pair so
// the conversion is exact integer arithmetic up to a single final rounding —
// dividing by a float literal would introduce drift the money-in-cents rule
// exists to prevent.
const CM2_PER_SQFT_NUMERATOR = 10_000;
const CM2_PER_SQFT_DENOMINATOR = 9_290_304;

// ── the two predicates ───────────────────────────────────────────────────
//
// These are NOT the same and must not be collapsed into one. A measured panel
// whose category has no rate is warned but still installed — the handyman fits
// it whether or not an admin has priced that category. Defining install as "not
// warned" would make install cost silently change when someone edits a rate.

/** Governs INSTALL. Deliberately keyed off measurement alone. */
export function isMeasured(p: MeshPanel): boolean {
  return (
    !!p.categoryId &&
    p.widthCm != null &&
    p.widthCm > 0 &&
    p.heightCm != null &&
    p.heightCm > 0
  );
}

/** Governs WARNINGS. Requires a non-null sale rate — a category can be unpriced. */
export function isPriced(p: MeshPanel, book: MeshPriceBook): boolean {
  return rateFor(p, book)?.saleSgdCentsPerSqft != null;
}

export function panelAreaCm2(p: MeshPanel): number | null {
  if (p.widthCm == null || p.heightCm == null) return null;
  if (p.widthCm <= 0 || p.heightCm <= 0) return null;
  return p.widthCm * p.heightCm;
}

export function rateFor(p: MeshPanel, book: MeshPriceBook): MeshRate | null {
  if (!isMeasured(p)) return null;
  return book.rates[p.categoryId as string] ?? null;
}

/**
 * Area × rate, rounded to the nearest cent ONCE per panel.
 *
 * Rounding per panel rather than on the order total is deliberate: each panel is
 * a line item the customer can see, so the printed lines must sum to the printed
 * total.
 *
 * Takes the area it is given. Applying the minimum is `panelBillableArea`'s job,
 * so this stays a pure conversion.
 */
export function scaleByArea(areaCm2: number, ratePerSqft: number): number {
  return Math.round(
    (areaCm2 * ratePerSqft * CM2_PER_SQFT_NUMERATOR) / CM2_PER_SQFT_DENOMINATOR,
  );
}

/** Panels that attract an installation charge. */
export function meshInstallUnits(panels: MeshPanel[]): number {
  return panels.filter(isMeasured).length;
}

type Money = { costRmbCents: number; saleSgdCents: number };

const ZERO: Money = { costRmbCents: 0, saleSgdCents: 0 };

/**
 * The double-draw surcharge for this panel, or zero.
 *
 * Charged per panel, not per ft²: it is one extra roller-and-handle set
 * whatever the panel's size. Keyed on the system the panel resolves to, since
 * heavier systems carry costlier hardware. A single draw, an unresolvable
 * system, or a system with no surcharge configured all contribute nothing.
 */
export function doubleDrawSurcharge(
  p: MeshPanel,
  book: MeshPriceBook,
): Money {
  if (!isDoubleDraw(p.draw ?? undefined)) return ZERO;

  const resolved = resolveMeshSystem(
    { widthCm: p.widthCm, draw: p.draw ?? undefined },
    book.bands,
  );
  if (resolved.status !== "resolved") return ZERO;

  const s = book.doubleSurcharges[resolved.system.trim().toLowerCase()];
  return {
    costRmbCents: s?.costRmbCents ?? 0,
    saleSgdCents: s?.saleSgdCents ?? 0,
  };
}

export type MeshBillableArea = {
  /** What was measured. */
  actualCm2: number;
  /** The floor for this panel — 0 when none is configured. */
  minimumCm2: number;
  /** What the price is actually calculated on. */
  billableCm2: number;
};

/**
 * The area a panel is charged on: the larger of what was measured and the
 * minimum for its category and system.
 *
 * The floor is stored per leaf, so a double draw takes it twice — a double is
 * two leaves and each carries its own minimum. A panel whose system does not
 * resolve, or whose (category, system) cell is empty, has no floor and bills at
 * what was measured.
 */
export function panelBillableArea(
  p: MeshPanel,
  book: MeshPriceBook,
): MeshBillableArea | null {
  const actualCm2 = panelAreaCm2(p);
  if (actualCm2 == null || !p.categoryId) return null;

  const resolved = resolveMeshSystem(
    { widthCm: p.widthCm, draw: p.draw ?? undefined },
    book.bands,
  );

  const perLeaf =
    resolved.status === "resolved"
      ? (book.minimumAreas[minimumKey(p.categoryId, resolved.system)] ?? 0)
      : 0;

  const minimumCm2 = perLeaf * (isDoubleDraw(p.draw ?? undefined) ? 2 : 1);

  return {
    actualCm2,
    minimumCm2,
    billableCm2: Math.max(actualCm2, minimumCm2),
  };
}

// The category's per-ft² rate scaled by this panel's area, plus the colour's
// flat surcharge and — on a double draw — the system's flat surcharge. Neither
// surcharge is scaled: both are per-panel charges, not per-ft² ones.
export function panelQuote(p: MeshPanel, book: MeshPriceBook): Money {
  const rate = rateFor(p, book);
  if (!rate) return ZERO;

  // The floored area, not the measured one — and the same figure on both
  // sides, so a minimum never flatters the margin.
  const billable = panelBillableArea(p, book);
  if (billable == null) return ZERO;
  const area = billable.billableCm2;

  const colour = p.colourId ? book.colours[p.colourId] : undefined;
  const double = doubleDrawSurcharge(p, book);

  return {
    costRmbCents:
      scaleByArea(area, rate.costRmbCentsPerSqft ?? 0) +
      (colour?.costRmbCents ?? 0) +
      double.costRmbCents,
    saleSgdCents:
      scaleByArea(area, rate.saleSgdCentsPerSqft ?? 0) +
      (colour?.saleSgdCents ?? 0) +
      double.saleSgdCents,
  };
}

export function computeMeshQuote(
  panels: MeshPanel[],
  book: MeshPriceBook,
  a: MeshCalcAssumptions,
  freightMode: FreightMode = "air",
  extraInstallSgdCents = 0,
  discountBps = 0,
): QuoteResult {
  const totals = panels.reduce(
    (acc, p) => {
      const q = panelQuote(p, book);
      return {
        costRmbCents: acc.costRmbCents + q.costRmbCents,
        saleSgdCents: acc.saleSgdCents + q.saleSgdCents,
      };
    },
    { costRmbCents: 0, saleSgdCents: 0 },
  );

  return finaliseQuote(
    {
      cogsRmbCents: totals.costRmbCents,
      // Unlike curtains, mesh bills freight on the full panel COGS — there are
      // no add-ons or tracks to exclude.
      freightBaseRmbCents: totals.costRmbCents,
      saleSgdCents: totals.saleSgdCents,
      installSgdCents: meshInstallUnits(panels) * a.handymanMeshSgdCents,
    },
    a,
    freightMode,
    extraInstallSgdCents,
    discountBps,
  );
}

// ── warnings ─────────────────────────────────────────────────────────────
//
// Kept out of QuoteResult so pricing stays decoupled from presentation. The
// live quote and the order detail card call this separately.

export type MeshWarningReason = "no-category" | "no-dimensions" | "no-rate";

export type MeshQuoteWarnings = {
  /** Indices into the panels array — zero sale reaching the customer. */
  unpricedPanels: number[];
  /** Deduped set of reasons present, for the notice text. */
  reasons: MeshWarningReason[];
  /**
   * Indices where the sale rate is configured but the cost rate isn't. These
   * price the customer correctly but report a margin near 100%, which the
   * below-floor guard can't catch because it sits ABOVE the floor. Separate
   * advisory.
   */
  missingCostPanels: number[];
};

export function meshQuoteWarnings(
  panels: MeshPanel[],
  book: MeshPriceBook,
): MeshQuoteWarnings {
  const unpricedPanels: number[] = [];
  const missingCostPanels: number[] = [];
  const reasons = new Set<MeshWarningReason>();

  panels.forEach((p, i) => {
    // A completely untouched row isn't a warning — it's a blank the consultant
    // hasn't filled in yet. Only flag a row that's been started.
    const blank =
      !p.categoryId && p.widthCm == null && p.heightCm == null && !p.colourId;
    if (blank) return;

    if (!p.categoryId) {
      unpricedPanels.push(i);
      reasons.add("no-category");
      return;
    }
    if (panelAreaCm2(p) == null) {
      unpricedPanels.push(i);
      reasons.add("no-dimensions");
      return;
    }
    const rate = book.rates[p.categoryId];
    if (rate?.saleSgdCentsPerSqft == null) {
      unpricedPanels.push(i);
      reasons.add("no-rate");
      // Fall through: a category with neither rate set is both unpriced and
      // cost-less, but the unpriced notice is the actionable one.
      return;
    }
    if (rate.costRmbCentsPerSqft == null) {
      missingCostPanels.push(i);
    }
  });

  return { unpricedPanels, reasons: [...reasons], missingCostPanels };
}
