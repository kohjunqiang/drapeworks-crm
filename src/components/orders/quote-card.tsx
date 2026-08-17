import { formatSGD } from "@/lib/money";
import { COGS_LABELS, visibleCogsLines } from "@/lib/pricing/cogs-labels";
import type { OrderQuote } from "@/lib/pricing/order-quote";

const pct = (bps: number) => `${(bps / 100).toFixed(1)}%`;
const rmb = (cents: number) => `¥${(cents / 100).toFixed(2)}`;

export function QuoteCard({ quote }: { quote: OrderQuote }) {
  const belowFloor = quote.marginBps < quote.minMarginBps;
  const hasDiscount = quote.discountBps > 0;

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-slate-800">
          Auto-calculated quote
        </h2>
        <span className="text-[10px] uppercase tracking-wide text-slate-400">
          from pricing
        </span>
      </div>

      <dl className="space-y-1.5 text-sm">
        {hasDiscount && (
          <>
            <div className="flex justify-between">
              <dt className="text-slate-500">Subtotal</dt>
              <dd className="text-slate-700">
                {formatSGD(quote.saleSgdCents)}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">
                Promotion
                {quote.promoLabel ? ` · ${quote.promoLabel}` : " · Custom"}
              </dt>
              <dd className="text-amber-700">−{pct(quote.discountBps)}</dd>
            </div>
          </>
        )}
        <div className="flex justify-between">
          <dt className="text-slate-500">Sale price</dt>
          <dd className="font-semibold text-slate-900">
            {formatSGD(quote.discountedSaleSgdCents)}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-slate-500">Net cost</dt>
          <dd className="text-slate-700">{formatSGD(quote.netCostSgdCents)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-slate-500">Margin</dt>
          <dd
            className={
              belowFloor
                ? "font-semibold text-red-600"
                : "font-semibold text-teal-700"
            }
          >
            {pct(quote.marginBps)}
          </dd>
        </div>
      </dl>

      {belowFloor && (
        <p className="mt-2 text-xs text-red-600">
          ⚠ Below the {pct(quote.minMarginBps)} margin floor — review before
          quoting.
        </p>
      )}

      <div className="mt-3 pt-3 border-t border-slate-100">
        <div className="flex justify-between text-xs text-slate-500">
          <span>Groupbuy price</span>
          <span>
            {formatSGD(quote.groupbuySgdCents)} · {pct(quote.groupbuyMarginBps)}
          </span>
        </div>
      </div>

      <details className="mt-3">
        <summary className="text-xs text-slate-500 cursor-pointer hover:text-slate-700">
          Cost breakdown
        </summary>
        <dl className="mt-2 space-y-1 text-xs text-slate-500">
          {/* COGS itemised — goods, each add-on, the rail — so the figures
              freight/other/GST are computed from are visible, not a lump. */}
          {visibleCogsLines(quote.cogsLines).map((line) => (
            <div key={line.key} className="flex justify-between">
              <dt>{COGS_LABELS[line.key]}</dt>
              <dd>{rmb(line.rmbCents)}</dd>
            </div>
          ))}
          <div className="flex justify-between">
            <dt>Freight (air)</dt>
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
          <div className="flex justify-between">
            <dt>Gross cost (SGD)</dt>
            <dd>{formatSGD(quote.grossCostSgdCents)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Installation</dt>
            <dd>{formatSGD(quote.installationSgdCents)}</dd>
          </div>
        </dl>
      </details>
    </div>
  );
}
