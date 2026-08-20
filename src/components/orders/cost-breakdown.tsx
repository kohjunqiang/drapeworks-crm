import { CogsRoomRows } from "@/components/orders/cogs-rooms";
import { formatSGD } from "@/lib/money";
import type { QuoteResult } from "@/lib/pricing/calculator";

// The China-side half of every cost breakdown, shared by the curtain live
// quote, the mesh live quote and the saved-order card so all three explain the
// cost the same way.
//
// The ORDER of these rows is the point. They used to run rooms → freight →
// other cost → GST, which reads as a running total: each line looks like it is
// charged on everything above it, so freight looks like part of the GST base.
// It is not. Other cost and GST are charged on COGS ALONE and freight is a
// sibling of theirs, not a step before them. So COGS gets a subtotal of its own
// (it never had one — the rooms summed to a figure that was nowhere on screen),
// the two markups are indented under it and say what they are a percentage OF,
// and freight sits back at the outer level where it belongs.

const rmb = (cents: number) => `¥${(cents / 100).toFixed(2)}`;

/** 900 → "9%", 1050 → "10.5%". */
const pct = (bps: number) => `${(bps / 100).toFixed(1).replace(/\.0$/, "")}%`;

export type BreakdownQuote = Pick<
  QuoteResult,
  | "cogsRooms"
  | "cogsExtras"
  | "cogsRmbCents"
  | "freightRmbCents"
  | "freightMode"
  | "otherCostRmbCents"
  | "gstRmbCents"
  | "otherCostBps"
  | "gstBps"
  | "grossCostRmbCents"
  | "grossCostSgdCents"
>;

export function CostBreakdown({ quote }: { quote: BreakdownQuote }) {
  return (
    <dl className="mt-1 space-y-0.5 text-slate-500">
      {/* Room by room, window by window, leg by leg. */}
      <CogsRoomRows rooms={quote.cogsRooms} extras={quote.cogsExtras} />

      <div className="flex justify-between gap-2 border-t border-slate-100 pt-0.5 mt-0.5 text-slate-700">
        <dt>COGS</dt>
        <dd className="whitespace-nowrap">{rmb(quote.cogsRmbCents)}</dd>
      </div>
      <div className="flex justify-between gap-2 pl-3">
        <dt className="truncate">Other cost · {pct(quote.otherCostBps)} of COGS</dt>
        <dd className="whitespace-nowrap">{rmb(quote.otherCostRmbCents)}</dd>
      </div>
      <div className="flex justify-between gap-2 pl-3">
        <dt className="truncate">GST · {pct(quote.gstBps)} of COGS</dt>
        <dd className="whitespace-nowrap">{rmb(quote.gstRmbCents)}</dd>
      </div>
      <div className="flex justify-between gap-2">
        {/* Charged on the goods, not on the goods-plus-markups — and never
            itself a base for the two rows above. */}
        <dt>Freight ({quote.freightMode === "sea" ? "sea" : "air"})</dt>
        <dd className="whitespace-nowrap">{rmb(quote.freightRmbCents)}</dd>
      </div>

      <div className="flex justify-between gap-2 border-t border-slate-100 pt-0.5 mt-0.5 text-slate-700">
        <dt>Gross cost</dt>
        <dd className="whitespace-nowrap">
          {rmb(quote.grossCostRmbCents)} → {formatSGD(quote.grossCostSgdCents)}
        </dd>
      </div>
    </dl>
  );
}
