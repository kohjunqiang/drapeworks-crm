import Link from "next/link";

import { formatSGD } from "@/lib/money";

import { StatusBadge } from "./status-badge";
import type { OrderRow } from "./orders-table";

type Props = {
  orders: OrderRow[];
};

const SG_DATE = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

function formatDate(d: Date | string | null): string {
  if (!d) return "—";
  return SG_DATE.format(new Date(d));
}

export function OrdersCards({ orders }: Props) {
  return (
    <div className="md:hidden space-y-3">
      {orders.map((o) => (
        <Link
          key={o.id}
          href={`/orders/${o.id}`}
          className="block bg-white rounded-lg border border-slate-200 p-4 active:bg-slate-50"
        >
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-slate-900 truncate">
                {o.customer_name}
              </div>
              <div className="text-xs text-slate-500 mt-0.5">
                {[o.development, o.display_id].filter(Boolean).join(" · ")}
              </div>
            </div>
            <div className="font-semibold text-slate-900 text-sm">
              {formatSGD(o.price_quoted_cents)}
            </div>
          </div>
          <div className="flex items-center justify-between gap-2 mt-3">
            <StatusBadge status={o.current_status} />
            <div className="text-xs text-slate-500">
              Move-in {formatDate(o.move_in_date)}
            </div>
          </div>
        </Link>
      ))}
      {orders.length === 0 && (
        <div className="text-center py-12 text-sm text-slate-500">
          No orders match your filters.
        </div>
      )}
    </div>
  );
}
