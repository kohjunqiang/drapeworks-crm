"use client";

import { useMemo } from "react";
import { useFormContext, useWatch } from "react-hook-form";

import { useQuoteAutofill } from "@/components/orders/consultation-form/use-quote-autofill";
import { formatSGD } from "@/lib/money";
import { COGS_LABELS, visibleCogsLines } from "@/lib/pricing/cogs-labels";
import {
  computeMeshQuote,
  meshQuoteWarnings,
  type MeshPanel,
} from "@/lib/pricing/mesh-calculator";
import type { MeshCalcConfig } from "@/lib/pricing/order-quote";
import type { MeshOrderEditInput } from "@/lib/validation/mesh";

const pct = (bps: number) => `${(bps / 100).toFixed(1)}%`;
const rmb = (cents: number) => `¥${(cents / 100).toFixed(2)}`;

function toNum(v: unknown): number | null {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const REASON_TEXT: Record<string, string> = {
  "no-category": "no category chosen",
  "no-dimensions": "missing width or height",
  "no-rate": "that category has no S$/ft² rate set",
};

export function MeshLiveQuote({ config }: { config: MeshCalcConfig }) {
  const { control } = useFormContext<MeshOrderEditInput>();
  const rooms = useWatch({ control, name: "rooms" });
  const freightMode =
    useWatch({ control, name: "order.freight_mode" }) ?? "air";
  const channel = useWatch({ control, name: "order.channel" }) ?? "standard";
  const extraInstallCents =
    useWatch({ control, name: "order.extra_install_cents" }) ?? 0;
  const discountBps = useWatch({ control, name: "order.discount_bps" }) ?? 0;

  const panels: MeshPanel[] = useMemo(() => {
    const out: MeshPanel[] = [];
    for (const room of rooms ?? []) {
      for (const p of room?.panels ?? []) {
        out.push({
          categoryId: p?.category_id || null,
          colourId: p?.colour_id || null,
          widthCm: toNum(p?.width_cm),
          heightCm: toNum(p?.height_cm),
          draw: p?.draw ?? null,
        });
      }
    }
    return out;
  }, [rooms]);

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

  const hasPriced = quote.saleSgdCents > 0;
  const floorBps =
    channel === "carousell"
      ? config.minMarginCarousellBps
      : config.minMarginBps;
  const belowFloor = hasPriced && quote.marginBps < floorBps;

  return (
    <div className="sticky top-2 z-10 bg-white rounded-lg border border-slate-200 shadow-sm p-3 mb-4">
      <div className="flex items-center justify-between gap-4">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Live quote
        </span>
        {hasPriced ? (
          <div className="flex items-center gap-4 sm:gap-6 text-sm">
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
        <details className="mt-2 border-t border-slate-100 pt-2">
          <summary className="text-xs text-slate-500 cursor-pointer hover:text-slate-700 select-none">
            Cost breakdown
          </summary>
          <div className="mt-2 max-w-sm text-xs">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              China costs (RMB)
            </p>
            <dl className="mt-1 space-y-0.5 text-slate-500">
              {/* One row per cost component — mesh, colour surcharge,
                  double-draw hardware — rather than a single lump. */}
              {visibleCogsLines(quote.cogsLines).map((line) => (
                <div key={line.key} className="flex justify-between">
                  <dt>{COGS_LABELS[line.key]}</dt>
                  <dd>{rmb(line.rmbCents)}</dd>
                </div>
              ))}
              <div className="flex justify-between">
                <dt>Freight ({freightMode === "sea" ? "sea" : "air"})</dt>
                <dd>{rmb(quote.freightRmbCents)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Other cost</dt>
                <dd>{rmb(quote.otherCostRmbCents)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>GST</dt>
                <dd>{rmb(quote.gstRmbCents)}</dd>
              </div>
              <div className="flex justify-between border-t border-slate-100 pt-0.5 mt-0.5 text-slate-700">
                <dt>Gross cost</dt>
                <dd>
                  {rmb(quote.grossCostRmbCents)} →{" "}
                  {formatSGD(quote.grossCostSgdCents)}
                </dd>
              </div>
            </dl>

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
