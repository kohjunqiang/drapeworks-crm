// The staleness decision for a batch of orders, as a pure function.
//
// Split out of order-quote.ts (which is `server-only` and does the IO) so the
// routing decision — which engine quotes which order — is unit-testable. That
// routing is the part with a real failure mode: a mesh order has zero `windows`
// rows, so quoting it through the curtain engine yields a $0 sale, which never
// equals a captured baseline, which means a re-quote banner that no action can
// clear.

import { computeQuote, type CalcWindow } from "./calculator";
import {
  computeMeshQuote,
  type MeshCalcAssumptions,
  type MeshPanel,
  type MeshPriceBook,
} from "./mesh-calculator";
import { quoteStaleness } from "./quote-staleness";

export type StaleOrderRow = {
  id: string;
  product_line: "curtain" | "mesh";
  freight_mode: "air" | "sea";
  extra_install_sgd_cents: number;
  discount_bps: number;
  price_calc_at_quote_cents: number | null;
};

export type StaleFlagsInput = {
  orders: StaleOrderRow[];
  // Each CalcWindow arrives carrying its own add-ons (Phase 14) — there is no
  // longer an order-wide add-on book to pass alongside.
  windowsByOrder: Map<string, CalcWindow[]>;
  panelsByOrder: Map<string, MeshPanel[]>;
  meshBook: MeshPriceBook;
  assumptions: MeshCalcAssumptions;
};

/** orderId → isStale. Absent/false = not stale. */
export function computeStaleFlags(
  input: StaleFlagsInput,
): Map<string, boolean> {
  const flags = new Map<string, boolean>();

  for (const o of input.orders) {
    // No baseline captured → never stale (quoteStaleness handles the null).
    // Each order goes through the engine matching its product line.
    const live =
      o.product_line === "mesh"
        ? computeMeshQuote(
            input.panelsByOrder.get(o.id) ?? [],
            input.meshBook,
            input.assumptions,
            o.freight_mode,
            o.extra_install_sgd_cents,
            o.discount_bps,
          )
        : computeQuote(
            input.windowsByOrder.get(o.id) ?? [],
            input.assumptions,
            o.freight_mode,
            o.extra_install_sgd_cents,
            o.discount_bps,
          );

    flags.set(
      o.id,
      quoteStaleness(o.price_calc_at_quote_cents, live.discountedSaleSgdCents)
        .isStale,
    );
  }

  return flags;
}
