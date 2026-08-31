"use client";

import { useEffect, useMemo } from "react";
import { useFormContext, useWatch } from "react-hook-form";

import { CostBreakdown } from "@/components/orders/cost-breakdown";
import type { ActiveCombo } from "@/lib/db/combos";
import type { CurtainPackageRow } from "@/lib/db/product-pricing-settings";
import { makePackageContext, packagePricingSignature, type SavedPackageSnapshot } from "@/lib/pricing/curtain-package-rules";
import { formatSGD } from "@/lib/money";
import {
  computeQuote,
  marginBps,
  type CalcWindow,
  type SeriesPrice,
} from "@/lib/pricing/calculator";
import {
  resolveWindowAddons,
  toCalcAddons,
} from "@/lib/orders/window-addons";
import type { CalcConfig } from "@/lib/pricing/order-quote";
import type { OrderEditInput } from "@/lib/validation/order";

import { useCollapseOnScroll } from "./use-collapse-on-scroll";
import { useQuoteAutofill } from "./use-quote-autofill";

import type { CurtainTypeOption } from "./window-fields";

const pct = (bps: number) => `${(bps / 100).toFixed(1)}%`;

function toWidthCm(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function LiveQuote({
  curtainTypes,
  config,
  combos,
  curtainPackages,
  savedPackageSnapshot,
  persistedAddonIdsByWindow = {},
}: {
  curtainTypes: CurtainTypeOption[];
  config: CalcConfig;
  combos: ActiveCombo[];
  curtainPackages: CurtainPackageRow[];
  savedPackageSnapshot?: SavedPackageSnapshot;
  persistedAddonIdsByWindow?: Record<string, string[]>;
}) {
  const { control, setValue } = useFormContext<OrderEditInput>();
  const rooms = useWatch({ control, name: "rooms" });
  const quotedCents =
    useWatch({ control, name: "order.price_quoted_cents" }) ?? 0;
  const freightMode =
    useWatch({ control, name: "order.freight_mode" }) ?? "air";
  const channel = useWatch({ control, name: "order.channel" }) ?? "standard";
  const extraInstallCents =
    useWatch({ control, name: "order.extra_install_cents" }) ?? 0;
  const discountBps = useWatch({ control, name: "order.discount_bps" }) ?? 0;
  const packageId = useWatch({ control, name: "order.curtain_package_id" }) ?? "";
  const packageTier = useWatch({ control, name: "order.curtain_package_tier" }) ?? "essential";
  const singleLayer = useWatch({ control, name: "order.curtain_package_single_layer" }) ?? "night";
  const selectedPackage = curtainPackages.find((item) => item.id === packageId);
  const packageContext = useMemo(() => {
    if (savedPackageSnapshot?.id === packageId && savedPackageSnapshot.rules) {
      return { ...savedPackageSnapshot.rules, tier: packageTier, singleLayer };
    }
    return selectedPackage ? makePackageContext(selectedPackage, packageTier, singleLayer, config.curtainRates) : null;
  }, [savedPackageSnapshot, packageId, packageTier, singleLayer, selectedPackage, config.curtainRates]);
  useEffect(() => {
    setValue("order.curtain_package_pricing_signature", packageContext ? packagePricingSignature(packageContext) : undefined);
  }, [packageContext, setValue]);

  const priceById = useMemo(() => {
    const m = new Map<string, SeriesPrice>();
    for (const c of curtainTypes) {
      m.set(c.id, {
        costRmbCents: c.costRmbCents,
        saleSgdCents: c.saleSgdCents,
        label: c.seriesName,
      });
    }
    return m;
  }, [curtainTypes]);

  const comboPriceById = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of combos) m.set(c.id, c.priceSgdCents);
    return m;
  }, [combos]);

  const quote = useMemo(() => {
    const priceOf = (id: string | undefined): SeriesPrice | null =>
      id ? (priceById.get(id) ?? null) : null;

    const windows: CalcWindow[] = (rooms ?? []).flatMap((r, roomIndex) =>
      (r?.windows ?? []).map((w) => {
        // Carried through pricing untouched, for the cost breakdown's room →
        // window tree. The label is whatever the consultant typed; a room they
        // haven't named yet falls back to its number.
        const where = { roomIndex, roomLabel: r?.label || null };
        // A blind carries no curtain, no add-ons and no combo — mirroring
        // windowValues on the server so the live figure and the saved quote
        // agree on what a blind window costs.
        const widthCm = toWidthCm(w.width_cm);
        // Resolved exactly as the server will resolve it on save, so the figure
        // on screen and the figure that gets stored cannot disagree.
        const addonsFor = (covering: "curtain" | "blind") =>
          toCalcAddons(
            resolveWindowAddons(
              covering,
              widthCm,
              w.addon_ids ?? [],
              persistedAddonIdsByWindow[
                (w as { id?: string }).id ?? ""
              ] ?? [],
              config.addonCatalogue,
            ),
          );

        if (w.variant === "blind") {
          return {
            ...where,
            covering: "blind",
            widthCm,
            blindPrice: priceOf(w.blind_type_id || undefined),
            addons: addonsFor("blind"),
            comboPriceSgdCents: null,
          };
        }

        const comboId = (w as { combo_id?: string }).combo_id;
        return {
          ...where,
          covering: "curtain",
          widthCm,
          dayPrice: priceOf(w.day_curtain_type_id || undefined),
          nightPrice: priceOf(w.night_curtain_type_id || undefined),
          addons: addonsFor("curtain"),
          comboPriceSgdCents: comboId
            ? (comboPriceById.get(comboId) ?? null)
            : null,
        };
      }),
    );
    return computeQuote(
      windows,
      config.assumptions,
      freightMode,
      extraInstallCents,
      discountBps,
      packageContext,
    );
  }, [
    rooms,
    priceById,
    comboPriceById,
    config,
    persistedAddonIdsByWindow,
    freightMode,
    extraInstallCents,
    discountBps,
    packageContext,
  ]);

  const hasMeasurements = quote.saleSgdCents > 0;
  const netCostSgdCents = quote.netCostSgdCents;
  // Margin tracks the price you'll actually charge (the editable Price quoted),
  // falling back to the calculated suggestion — the discounted sale — until it's
  // filled/overridden, so editing the quoted price updates the margin live.
  const salePrice =
    quotedCents > 0 ? quotedCents : quote.discountedSaleSgdCents;
  const shownMarginBps = marginBps(netCostSgdCents, salePrice);
  const groupbuyCents = Math.round(
    (salePrice * (10000 - config.assumptions.groupbuyDiscountBps)) / 10000,
  );
  const groupbuyMarginBps = marginBps(netCostSgdCents, groupbuyCents);
  // The active margin floor depends on the sales channel.
  const floorBps =
    channel === "carousell"
      ? config.minMarginCarousellBps
      : config.minMarginBps;
  const belowFloor = hasMeasurements && shownMarginBps < floorBps;

  // Shared with the mesh quote panel — one owner of the 50% deposit rule.
  useQuoteAutofill(quote.discountedSaleSgdCents);
  const breakdownRef = useCollapseOnScroll();

  return (
    <div className="sticky top-2 z-10 bg-white rounded-lg border border-slate-200 shadow-sm p-3 mb-4">
      {/* "Live quote" + three figures on one line fits a desk, not a phone. A
          four-figure quote — the normal case here — pushed the row past the
          card and scrolled the whole page sideways. On mobile the label takes
          its own line and the figures spread across the full width; from sm it
          is the original single row. */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Live quote
        </span>
        {hasMeasurements ? (
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm sm:justify-end sm:gap-6">
            <div className="flex items-baseline gap-1.5">
              <span className="text-slate-500 text-xs">Quoted</span>
              <span className="font-semibold text-slate-900">
                {formatSGD(salePrice)}
              </span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-slate-500 text-xs">Cost</span>
              <span className="text-slate-700">
                {formatSGD(netCostSgdCents)}
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
                {pct(shownMarginBps)}
              </span>
            </div>
          </div>
        ) : (
          <span className="text-xs text-slate-400">
            {quote.pricingIssues?.length ? "Resolve package pricing below to see a quote" : "Select priced curtains + widths to see the margin"}
          </span>
        )}
      </div>
      {belowFloor && (
        <p className="mt-1.5 text-xs text-red-600">
          ⚠ Below the {pct(floorBps)}{" "}
          {channel === "carousell" ? "Carousell " : ""}
          margin floor — review before quoting.
          {!packageContext && <> Groupbuy {formatSGD(groupbuyCents)} · {pct(groupbuyMarginBps)}.</>}
        </p>
      )}
      {!!quote.pricingIssues?.length && (
        <div role="alert" className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
          <p className="font-semibold">Package pricing incomplete — final save is blocked</p>
          <ul className="mt-1 list-disc pl-4">{quote.pricingIssues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
        </div>
      )}
      {quote.packageLines && !quote.pricingIssues?.length && (
        <details className="mt-2 border-t pt-2 text-xs">
          <summary className="cursor-pointer font-medium text-teal-700">Package selling-price breakdown</summary>
          <dl className="mt-2 max-h-[35dvh] space-y-1 overflow-y-auto">
            {quote.packageLines.map((line) => <div key={line.key} className="flex justify-between gap-4"><dt>{line.label}{line.quantity !== 1 ? ` × ${line.quantity}` : ""}</dt><dd className="whitespace-nowrap">{formatSGD(line.totalSgdCents)}</dd></div>)}
            <div className="flex justify-between gap-4 border-t pt-1"><dt>Other items / operational extras</dt><dd>{formatSGD(quote.saleSgdCents - quote.packageLines.reduce((sum, line) => sum + line.totalSgdCents, 0))}</dd></div>
            <div className="flex justify-between gap-4 font-semibold"><dt>Total before order discount</dt><dd>{formatSGD(quote.saleSgdCents)}</dd></div>
          </dl>
        </details>
      )}

      {hasMeasurements && (
        <details
          ref={breakdownRef}
          className="mt-2 border-t border-slate-100 pt-2"
        >
          <summary className="text-xs text-slate-500 cursor-pointer hover:text-slate-700 select-none">
            Cost breakdown
          </summary>
          {/* Capped so a long order can't turn the sticky panel into the whole
              screen — a four-room breakdown is taller than an iPhone SE. Past
              the cap the list scrolls inside itself, and overscroll-contain
              keeps that scroll from chaining into the page (which would
              collapse the panel via useCollapseOnScroll mid-read). */}
          <div className="mt-2 max-w-sm overflow-y-auto overscroll-contain text-xs max-h-[45dvh]">
            {/* China-side costs, in RMB → converted once. */}
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              China costs (RMB)
            </p>
            {/* Room by room, window by window — so it's clear which window is
                carrying the cost, not just what the order totals. */}
            <CostBreakdown quote={quote} />

            {/* Installation, its own category, in SGD. */}
            <p className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Installation (Handyman)
            </p>
            <dl className="mt-1 space-y-0.5 text-slate-500">
              <div className="flex justify-between">
                <dt>Handyman + extra install</dt>
                <dd>{formatSGD(quote.installationSgdCents)}</dd>
              </div>
            </dl>

            <dl className="mt-2 border-t border-slate-200 pt-1 font-medium text-slate-800">
              <div className="flex justify-between">
                <dt>Net cost (SGD)</dt>
                <dd>{formatSGD(netCostSgdCents)}</dd>
              </div>
            </dl>
          </div>
        </details>
      )}
    </div>
  );
}
