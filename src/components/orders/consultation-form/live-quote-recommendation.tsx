import { formatSGD } from "@/lib/money";
import { marginBps } from "@/lib/pricing/calculator";

const pct = (bps: number) => `${(bps / 100).toFixed(1)}%`;

function PriceEquation({ before, after }: { before: number; after: number }) {
  const difference = after - before;
  return (
    <span className="whitespace-nowrap">
      {formatSGD(before)} {difference < 0 ? "−" : "+"}{" "}
      {formatSGD(Math.abs(difference))} ={" "}
      <strong>{formatSGD(after)}</strong>
    </span>
  );
}

export function LiveQuoteRecommendation({
  currentCents,
  recommendedCents,
  groupbuyCents,
  netCostCents,
  baselineCents,
  baselineGroupbuyCents,
}: {
  currentCents: number;
  recommendedCents: number;
  groupbuyCents: number;
  netCostCents: number;
  baselineCents?: number | null;
  baselineGroupbuyCents?: number | null;
}) {
  const hasBaseline = baselineCents != null && baselineCents > 0;
  const referenceCents = hasBaseline ? baselineCents : currentCents;
  if (currentCents <= 0) return null;

  const groupbuyDifference =
    baselineGroupbuyCents != null && baselineGroupbuyCents > 0
      ? groupbuyCents - baselineGroupbuyCents
      : null;

  return (
    <div className="mt-3 border-t border-slate-100 pt-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="rounded-md border border-slate-200 bg-slate-50 p-2.5">
          <div className="text-xs font-medium text-slate-500">
            Current agreement
          </div>
          <div className="mt-0.5 font-semibold text-slate-900">
            {formatSGD(currentCents)}
          </div>
          <div className="text-xs font-medium text-teal-700">
            {pct(marginBps(netCostCents, currentCents))} margin
          </div>
        </div>
        <div className="rounded-md border border-slate-200 p-2.5">
          <div className="text-xs font-medium text-slate-500">
            System recommendation
          </div>
          <div className="mt-0.5 text-sm text-slate-900">
            {hasBaseline ? (
              <PriceEquation
                before={referenceCents}
                after={recommendedCents}
              />
            ) : (
              <strong>{formatSGD(recommendedCents)}</strong>
            )}
          </div>
          <div className="text-xs text-slate-500">
            {pct(marginBps(netCostCents, recommendedCents))} margin
          </div>
        </div>
      </div>
      <div className="mt-2 flex justify-between text-xs text-slate-500">
        <span>Groupbuy price</span>
        <span>
          {groupbuyDifference != null && baselineGroupbuyCents != null ? (
            <PriceEquation
              before={baselineGroupbuyCents}
              after={groupbuyCents}
            />
          ) : (
            formatSGD(groupbuyCents)
          )}{" "}
          ·{" "}
          {pct(marginBps(netCostCents, groupbuyCents))} margin
        </span>
      </div>
    </div>
  );
}
