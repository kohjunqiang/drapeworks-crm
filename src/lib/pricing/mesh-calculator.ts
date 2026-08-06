// Mesh pricing — the product-specific front end for window mesh panels.
//
// Where curtains price by width × a per-metre rate, mesh prices FLAT PER PANEL:
// look up (category, size band) in the price grid and add the colour surcharge.
// Everything downstream — freight, other cost, GST, RMB→SGD, install, the
// order discount, margin, groupbuy — is shared with curtains via finaliseQuote.
//
// Money is integer cents throughout (RMB cost cents, SGD sale cents); area is
// integer cm² so band matching never touches a float.
//
// See docs/specs/phase-11-mesh-product-line.md §6.

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
};

export type MeshBand = {
  id: string;
  maxAreaCm2: number | null; // null = the open-ended top band
};

export type MeshPriceCell = {
  costRmbCents: number | null; // null = cost not configured (margin unreliable)
  saleSgdCents: number | null; // null = not yet priced
};

export type MeshColourSurcharge = {
  costRmbCents: number | null;
  saleSgdCents: number | null;
};

// Plain records rather than Maps so the whole book crosses the server→client
// boundary as props, the same way CalcConfig does.
export type MeshPriceBook = {
  bands: MeshBand[];
  prices: Record<string, MeshPriceCell>; // key: `${categoryId}:${bandId}`
  colours: Record<string, MeshColourSurcharge>;
};

export const priceKey = (categoryId: string, bandId: string): string =>
  `${categoryId}:${bandId}`;

// ── the two predicates ───────────────────────────────────────────────────
//
// These are NOT the same and must not be collapsed into one. A measured panel
// whose price cell is empty is warned but still installed — the handyman fits
// it whether or not an admin has filled that cell in. Defining install as "not
// warned" would make install cost silently change when someone edits the grid.

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

/** Governs WARNINGS. Requires a non-null sale — a row can exist unfilled. */
export function isPriced(p: MeshPanel, book: MeshPriceBook): boolean {
  return priceCellFor(p, book)?.saleSgdCents != null;
}

export function panelAreaCm2(p: MeshPanel): number | null {
  if (p.widthCm == null || p.heightCm == null) return null;
  if (p.widthCm <= 0 || p.heightCm <= 0) return null;
  return p.widthCm * p.heightCm;
}

// Smallest band that fits, ordered by max area with the open-ended band last.
// Ordered here rather than by the bands' `position` column: pricing must not
// depend on a display-ordering value staying in sync.
export function resolveBand(
  areaCm2: number,
  bands: MeshBand[],
): MeshBand | null {
  const ordered = [...bands].sort((a, b) => {
    if (a.maxAreaCm2 == null) return b.maxAreaCm2 == null ? 0 : 1;
    if (b.maxAreaCm2 == null) return -1;
    return a.maxAreaCm2 - b.maxAreaCm2;
  });
  return (
    ordered.find((b) => b.maxAreaCm2 == null || areaCm2 <= b.maxAreaCm2) ?? null
  );
}

export function priceCellFor(
  p: MeshPanel,
  book: MeshPriceBook,
): MeshPriceCell | null {
  if (!isMeasured(p)) return null;
  const area = panelAreaCm2(p);
  if (area == null) return null;
  const band = resolveBand(area, book.bands);
  if (!band) return null;
  return book.prices[priceKey(p.categoryId as string, band.id)] ?? null;
}

/** Panels that attract an installation charge. */
export function meshInstallUnits(panels: MeshPanel[]): number {
  return panels.filter(isMeasured).length;
}

type Money = { costRmbCents: number; saleSgdCents: number };

const ZERO: Money = { costRmbCents: 0, saleSgdCents: 0 };

// Flat base for the (category, band) cell, plus the colour's flat surcharge.
// Neither is scaled by area — that's what "flat per panel" means.
export function panelQuote(p: MeshPanel, book: MeshPriceBook): Money {
  const cell = priceCellFor(p, book);
  if (!cell) return ZERO;

  const surcharge = p.colourId ? book.colours[p.colourId] : undefined;

  return {
    costRmbCents: (cell.costRmbCents ?? 0) + (surcharge?.costRmbCents ?? 0),
    saleSgdCents: (cell.saleSgdCents ?? 0) + (surcharge?.saleSgdCents ?? 0),
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

export type MeshWarningReason =
  | "no-category"
  | "no-dimensions"
  | "no-band"
  | "no-price-row"
  | "price-row-empty";

export type MeshQuoteWarnings = {
  /** Indices into the panels array — zero sale reaching the customer. */
  unpricedPanels: number[];
  /** Deduped set of reasons present, for the notice text. */
  reasons: MeshWarningReason[];
  /**
   * Indices where the sale is configured but the cost isn't. These price the
   * customer correctly but report a margin near 100%, which the below-floor
   * guard can't catch because it sits ABOVE the floor. Separate advisory.
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
    const area = panelAreaCm2(p);
    if (area == null) {
      unpricedPanels.push(i);
      reasons.add("no-dimensions");
      return;
    }
    const band = resolveBand(area, book.bands);
    if (!band) {
      unpricedPanels.push(i);
      reasons.add("no-band");
      return;
    }
    const cell = book.prices[priceKey(p.categoryId, band.id)];
    if (!cell) {
      unpricedPanels.push(i);
      reasons.add("no-price-row");
      return;
    }
    if (cell.saleSgdCents == null) {
      unpricedPanels.push(i);
      reasons.add("price-row-empty");
      // Fall through: a cell with neither sale nor cost is both unpriced and
      // cost-less, but the unpriced notice is the actionable one.
      return;
    }
    if (cell.costRmbCents == null) {
      missingCostPanels.push(i);
    }
  });

  return { unpricedPanels, reasons: [...reasons], missingCostPanels };
}
