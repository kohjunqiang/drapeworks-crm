"use client";

import { useMemo } from "react";
import { useFormContext, useWatch } from "react-hook-form";

import { CostBreakdown } from "@/components/orders/cost-breakdown";
import { useCollapseOnScroll } from "@/components/orders/consultation-form/use-collapse-on-scroll";
import { useQuoteAutofill } from "@/components/orders/consultation-form/use-quote-autofill";
import { formatSGD } from "@/lib/money";
import {
  computeMeshQuote,
  meshQuoteWarnings,
  type MeshPanel,
} from "@/lib/pricing/mesh-calculator";
import type { MeshCalcConfig } from "@/lib/pricing/order-quote";
import type { MeshOrderEditInput } from "@/lib/validation/mesh";

const pct = (bps: number) => `${(bps / 100).toFixed(1)}%`;

function toNum(v: unknown): number | null {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const REASON_TEXT: Record<string, string> = {
  "no-category": "no category chosen",
  "no-dimensions": "missing width or height",
  "no-rate": "that category has no S$/m² rate set",
};

export function MeshLiveQuote({ config }: { config: MeshCalcConfig }) {
  const { control } = useFormContext<MeshOrderEditInput>();
  const rooms = useWatch({ control, name: "rooms" });
  const freightMode =
    useWatch({ control, name: "order.freight_mode" }) ?? "sea";
  const channel = useWatch({ control, name: "order.channel" }) ?? "standard";
  const extraInstallCents =
    useWatch({ control, name: "order.extra_install_cents" }) ?? 0;
  const discountBps = useWatch({ control, name: "order.discount_bps" }) ?? 0;

  // Category names for the cost breakdown — the price book is keyed by id and
  // carries no names, so the panel brings its own label to pricing.
  const categoryNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of config.categories) m.set(c.id, c.name);
    return m;
  }, [config.categories]);

  const panels: MeshPanel[] = useMemo(() => {
    const out: MeshPanel[] = [];
    (rooms ?? []).forEach((room, roomIndex) => {
      for (const p of room?.panels ?? []) {
        out.push({
          categoryId: p?.category_id || null,
          colourId: p?.colour_id || null,
          widthCm: toNum(p?.width_cm),
          heightCm: toNum(p?.height_cm),
          draw: p?.draw ?? null,
          roomIndex,
          roomLabel: room?.label || null,
          itemDetail: p?.category_id
            ? (categoryNameById.get(p.category_id) ?? null)
            : null,
        });
      }
    });
    return out;
  }, [rooms, categoryNameById]);

  const quote = useMemo(
    () =>
      computeMeshQuote(
        panels,
        config.book,
        config.assumptions,
        freightMode,
        Number(extraInstallCents) || 0,
        Number(discountBps) || 0,
      ),
    [panels, config, freightMode, extraInstallCents, discountBps],
  );

  const warnings = useMemo(
    () => meshQuoteWarnings(panels, config.book),
    [panels, config.book],
  );

  // Same rule as the curtain panel, from the one shared owner.
  useQuoteAutofill(quote.discountedSaleSgdCents);
  const breakdownRef = useCollapseOnScroll();

  const hasPriced = quote.saleSgdCents > 0;
  const floorBps =
    channel === "carousell"
      ? config.minMarginCarousellBps
      : config.minMarginBps;
  const belowFloor = hasPriced && quote.marginBps < floorBps;

  return (
    <div className="sticky top-2 z-10 bg-white rounded-lg border border-slate-200 shadow-sm p-3 mb-4">
      {/* Stacks on mobile for the same reason as the curtain panel — three
          four-figure stats next to the label overflow a phone. */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Live quote
        </span>
        {hasPriced ? (
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm sm:justify-end sm:gap-6">
            <div className="flex items-baseline gap-1.5">
              <span className="text-slate-500 text-xs">Quoted</span>
              <span className="font-semibold text-slate-900">
                {formatSGD(quote.discountedSaleSgdCents)}
              </span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-slate-500 text-xs">Cost</span>
              <span className="text-slate-700">
                {formatSGD(quote.netCostSgdCents)}
              </span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-slate-500 text-xs">Margin</span>
              <span
                className={
                  belowFloor
                    ? "font-bold text-red-600"
                    : "font-bold text-teal-700"
                }
              >
                {pct(quote.marginBps)}
              </span>
            </div>
          </div>
        ) : (
          <span className="text-xs text-slate-400">
            Choose a category and enter width + height to see the margin
          </span>
        )}
      </div>

      {belowFloor && (
        <p className="mt-1.5 text-xs text-red-600">
          ⚠ Below the {pct(floorBps)}{" "}
          {channel === "carousell" ? "Carousell " : ""}margin floor — review
          before quoting.
        </p>
      )}

      {warnings.unpricedPanels.length > 0 && (
        <p className="mt-1.5 text-xs text-amber-700">
          ⚠ {warnings.unpricedPanels.length}{" "}
          {warnings.unpricedPanels.length === 1 ? "panel is" : "panels are"} not
          priced ({warnings.reasons.map((r) => REASON_TEXT[r] ?? r).join("; ")}
          ). They are quoted at $0 but still charged for installation.
        </p>
      )}

      {/* A blank cost is NOT an unpriced panel — the customer price is right,
          but margin reads far too high, and it sits above the floor so the
          below-floor warning above can never catch it. */}
      {warnings.missingCostPanels.length > 0 && (
        <p className="mt-1.5 text-xs text-amber-700">
          ⚠ {warnings.missingCostPanels.length}{" "}
          {warnings.missingCostPanels.length === 1
            ? "panel has"
            : "panels have"}{" "}
          no cost configured, so the margin above is overstated. Set the cost in
          the mesh price grid.
        </p>
      )}

      {hasPriced && (
        <details
          ref={breakdownRef}
          className="mt-2 border-t border-slate-100 pt-2"
        >
          <summary className="text-xs text-slate-500 cursor-pointer hover:text-slate-700 select-none">
            Cost breakdown
          </summary>
          {/* Capped and self-scrolling for the same reason as the curtain
              panel — see the note there. */}
          <div className="mt-2 max-w-sm overflow-y-auto overscroll-contain text-xs max-h-[45dvh]">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              China costs (RMB)
            </p>
            {/* Room by room, panel by panel. */}
            <CostBreakdown quote={quote} />

            <p className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Installation (Handyman)
            </p>
            <dl className="mt-1 space-y-0.5 text-slate-500">
              <div className="flex justify-between">
                <dt>Drill + silicone, per measured panel</dt>
                <dd>{formatSGD(quote.installationSgdCents)}</dd>
              </div>
            </dl>

            <dl className="mt-2 border-t border-slate-200 pt-1 font-medium text-slate-800">
              <div className="flex justify-between">
                <dt>Net cost (SGD)</dt>
                <dd>{formatSGD(quote.netCostSgdCents)}</dd>
              </div>
            </dl>
          </div>
        </details>
      )}
    </div>
  );
}
