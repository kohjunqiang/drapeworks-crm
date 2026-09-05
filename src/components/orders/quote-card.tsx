import { CostBreakdown } from "@/components/orders/cost-breakdown";
import { RequoteBanner } from "@/components/orders/requote-banner";
import { formatSGD } from "@/lib/money";
import { marginBps as marginOf } from "@/lib/pricing/calculator";
import type { OrderQuote } from "@/lib/pricing/order-quote";

const pct = (bps: number) => `${(bps / 100).toFixed(1)}%`;

export function QuoteCard({
  quote,
  quotedCents,
  orderId,
  depositCents = 0,
  locked = false,
  meshAreas,
}: {
  quote: OrderQuote;
  /** What the customer is actually being charged, when it differs from what the
   *  calculator worked out. */
  quotedCents?: number;
  orderId?: string;
  depositCents?: number;
  locked?: boolean;
  meshAreas?: Array<{
    label: string;
    dimensions: string;
    measuredSqm: number;
    billableSqm: number;
  }>;
}) {
  // The margin that matters is the one against the price actually quoted. This
  // card used to compute it against the CALCULATED sale, so an order priced by
  // hand above the calculation still showed the calculated margin — and warned
  // "below the floor" while the real margin was comfortably above it. That is
  // the one case where a margin warning has to be right, because someone has
  // deliberately departed from the calculation.
  const overridden =
    quotedCents != null && quotedCents !== quote.discountedSaleSgdCents;
  const realMarginBps = overridden
    ? marginOf(quote.netCostSgdCents, quotedCents)
    : quote.marginBps;
  const belowFloor = realMarginBps < quote.minMarginBps;
  const hasDiscount = quote.discountBps > 0;

  if (quote.pricingIssues?.length) return (
    <section className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
      <h2 className="font-semibold">Package pricing needs attention</h2>
      <ul className="mt-2 list-disc pl-4">{quote.pricingIssues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
      <p className="mt-2">The saved customer price has not changed. Resolve these items before re-quoting.</p>
    </section>
  );

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-slate-800">
          Pricing recommendation
        </h2>
        <span className="text-[10px] uppercase tracking-wide text-slate-400">
          internal
        </span>
      </div>

      {quote.packageLines && (
        <details className="mb-3 border-b pb-3 text-xs">
          <summary className="cursor-pointer font-medium text-teal-700">Package selling-price breakdown</summary>
          <dl className="mt-2 space-y-1">
            {quote.packageLines.map((line) => <div key={line.key} className="flex justify-between gap-4"><dt>{line.label}{line.quantity !== 1 ? ` × ${line.quantity}` : ""}</dt><dd className="whitespace-nowrap">{formatSGD(line.totalSgdCents)}</dd></div>)}
            <div className="flex justify-between gap-4 border-t pt-1"><dt>Other items / operational extras</dt><dd>{formatSGD(quote.saleSgdCents - quote.packageLines.reduce((sum, line) => sum + line.totalSgdCents, 0))}</dd></div>
          </dl>
        </details>
      )}
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
        {overridden ? (
          <div className="grid grid-cols-2 gap-3 pb-1">
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <dt className="text-xs font-medium text-slate-500">
                Current agreement
              </dt>
              <dd className="mt-1 text-base font-semibold text-slate-900">
                {formatSGD(quotedCents)}
              </dd>
              <dd
                className={`mt-0.5 text-xs font-medium ${
                  belowFloor ? "text-red-600" : "text-teal-700"
                }`}
              >
                {pct(realMarginBps)} margin
              </dd>
            </div>
            <div className="rounded-md border border-slate-200 p-3">
              <dt className="text-xs font-medium text-slate-500">
                System recommendation
              </dt>
              <dd className="mt-1 text-base font-semibold text-slate-900">
                {formatSGD(quote.discountedSaleSgdCents)}
              </dd>
              <dd className="mt-0.5 text-xs text-slate-500">
                {quote.discountedSaleSgdCents > quotedCents ? "+" : ""}
                {formatSGD(quote.discountedSaleSgdCents - quotedCents)} ·{" "}
                {pct(quote.marginBps)} margin
              </dd>
            </div>
          </div>
        ) : (
          <div className="flex justify-between">
            <dt className="text-slate-500">Agreed customer price</dt>
            <dd className="font-semibold text-slate-900">
              {formatSGD(quotedCents ?? quote.discountedSaleSgdCents)}
            </dd>
          </div>
        )}
        <div className="flex justify-between">
          <dt className="text-slate-500">Net cost</dt>
          <dd className="text-slate-700">{formatSGD(quote.netCostSgdCents)}</dd>
        </div>
        {!overridden && (
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
        )}
      </dl>

      {quote.isStale && quotedCents != null &&
        (locked ? (
          <p className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
            Current recommendation is {formatSGD(quote.discountedSaleSgdCents)};
            this order remains locked at the agreed price of{" "}
            {formatSGD(quotedCents)}.
          </p>
        ) : orderId ? (
          <RequoteBanner
            orderId={orderId}
            lockedCents={quotedCents}
            liveCents={quote.discountedSaleSgdCents}
            depositCents={depositCents}
          />
        ) : null)}

      {belowFloor && (
        <p className="mt-2 text-xs text-red-600">
          ⚠ Below the {pct(quote.minMarginBps)} margin floor — review before
          quoting.
        </p>
      )}

      <details className="mt-3">
        <summary className="text-xs text-slate-500 cursor-pointer hover:text-slate-700">
          Cost breakdown
        </summary>
        <div className="mt-2 text-xs">
          {meshAreas && meshAreas.length > 0 && (
            <div className="mb-3 rounded-md bg-slate-50 p-2.5">
              <div className="mb-2 flex items-center justify-between font-semibold text-slate-700">
                <span>Billable mesh area</span>
                <span>
                  {meshAreas
                    .reduce((total, item) => total + item.billableSqm, 0)
                    .toFixed(1)}{" "}
                  m² total
                </span>
              </div>
              <dl className="space-y-1.5">
                {meshAreas.map((item) => {
                  const areaAdjusted = item.measuredSqm !== item.billableSqm;
                  return (
                    <div
                      key={`${item.label}-${item.dimensions}`}
                      className="flex items-start justify-between gap-3"
                    >
                      <dt className="min-w-0 text-slate-500">
                        <span className="block truncate text-slate-700">
                          {item.label}
                        </span>
                        <span>{item.dimensions}</span>
                      </dt>
                      <dd className="shrink-0 text-right font-medium text-slate-800">
                        {item.billableSqm.toFixed(1)} m²
                        {areaAdjusted && (
                          <span className="block font-normal text-slate-400">
                            measured {item.measuredSqm.toFixed(2)} m²
                          </span>
                        )}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </div>
          )}
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
