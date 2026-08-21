import { CostBreakdown } from "@/components/orders/cost-breakdown";
import { formatSGD } from "@/lib/money";
import { marginBps as marginOf } from "@/lib/pricing/calculator";
import type { OrderQuote } from "@/lib/pricing/order-quote";

const pct = (bps: number) => `${(bps / 100).toFixed(1)}%`;

export function QuoteCard({
  quote,
  quotedCents,
}: {
  quote: OrderQuote;
  /** What the customer is actually being charged, when it differs from what the
   *  calculator worked out. */
  quotedCents?: number;
}) {
  // The margin that matters is the one against the price actually quoted. This
  // card used to compute it against the CALCULATED sale, so an order priced by
  // hand above the calculation still showed the calculated margin — and warned
  // "below the floor" while the real margin was comfortably above it. That is
  // the one case where a margin warning has to be right, because someone has
  // deliberately departed from the calculation.
  const overridden = quotedCents != null && quotedCents !== quote.saleSgdCents;
  const realMarginBps = overridden
    ? marginOf(quote.netCostSgdCents, quotedCents)
    : quote.marginBps;
  const belowFloor = realMarginBps < quote.minMarginBps;
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
            {pct(realMarginBps)}
          </dd>
        </div>
        {overridden && (
          <div className="flex justify-between text-xs">
            <dt className="text-slate-400">
              against the quoted {formatSGD(quotedCents)}
            </dt>
            <dd className="text-slate-400">
              calculated {pct(quote.marginBps)}
            </dd>
          </div>
        )}
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
        <div className="mt-2 text-xs">
          {/* COGS room by room, so it's visible which room drives the cost. */}
          <CostBreakdown quote={quote} />
          <dl className="mt-1 space-y-0.5 text-xs text-slate-500">
            <div className="flex justify-between gap-2">
              <dt>Installation</dt>
              <dd className="whitespace-nowrap">
                {formatSGD(quote.installationSgdCents)}
              </dd>
            </div>
            {/* The figure the list adds up to. It is on the card above as well,
                but a breakdown that stops one line short of its own total makes
                the reader add gross cost and installation themselves to check
                the two agree — which is the whole reason to open this. */}
            <div className="flex justify-between gap-2 border-t border-slate-200 pt-1 mt-1 font-medium text-slate-800">
              <dt>Net cost</dt>
              <dd className="whitespace-nowrap">
                {formatSGD(quote.netCostSgdCents)}
              </dd>
            </div>
          </dl>
        </div>
      </details>
    </div>
  );
}
