"use client";

import { useMemo } from "react";
import { useFormContext, useWatch } from "react-hook-form";

import { CostBreakdown } from "@/components/orders/cost-breakdown";
import type { ActiveCombo } from "@/lib/db/combos";
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
  persistedAddonIdsByWindow = {},
}: {
  curtainTypes: CurtainTypeOption[];
  config: CalcConfig;
  combos: ActiveCombo[];
  persistedAddonIdsByWindow?: Record<string, string[]>;
}) {
  const { control } = useFormContext<OrderEditInput>();
  const rooms = useWatch({ control, name: "rooms" });
  const quotedCents =
    useWatch({ control, name: "order.price_quoted_cents" }) ?? 0;
  const freightMode =
    useWatch({ control, name: "order.freight_mode" }) ?? "air";
  const channel = useWatch({ control, name: "order.channel" }) ?? "standard";
  const extraInstallCents =
    useWatch({ control, name: "order.extra_install_cents" }) ?? 0;
  const discountBps = useWatch({ control, name: "order.discount_bps" }) ?? 0;

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
            widthCm,
            blindPrice: priceOf(w.blind_type_id || undefined),
            addons: addonsFor("blind"),
            comboPriceSgdCents: null,
          };
        }

        const comboId = (w as { combo_id?: string }).combo_id;
        return {
          ...where,
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

  return (
    <div className="sticky top-2 z-10 bg-white rounded-lg border border-slate-200 shadow-sm p-3 mb-4">
      <div className="flex items-center justify-between gap-4">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Live quote
        </span>
        {hasMeasurements ? (
          <div className="flex items-center gap-4 sm:gap-6 text-sm">
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
            Select priced curtains + widths to see the margin
          </span>
        )}
      </div>
      {belowFloor && (
        <p className="mt-1.5 text-xs text-red-600">
          ⚠ Below the {pct(floorBps)}{" "}
          {channel === "carousell" ? "Carousell " : ""}
          margin floor — review before quoting. Groupbuy{" "}
          {formatSGD(groupbuyCents)} · {pct(groupbuyMarginBps)}.
        </p>
      )}

      {hasMeasurements && (
        <details className="mt-2 border-t border-slate-100 pt-2">
          <summary className="text-xs text-slate-500 cursor-pointer hover:text-slate-700 select-none">
            Cost breakdown
          </summary>
          <div className="mt-2 max-w-sm text-xs">
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
