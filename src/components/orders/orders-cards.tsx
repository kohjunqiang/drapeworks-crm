import Link from "next/link";

import { formatSGD } from "@/lib/money";
import { primaryOrderIdentifier } from "@/lib/orders/reference";

import { productLineLabel } from "./orders-table";

import { StatusBadge } from "./status-badge";
import type { OrderRow } from "./orders-table";
import { DeleteOrderDialog } from "./delete-order-dialog";

type Props = {
  orders: OrderRow[];
  canDelete?: boolean;
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

export function OrdersCards({ orders, canDelete = false }: Props) {
  return (
    <div className="md:hidden space-y-3">
      {orders.map((o) => (
        <article key={o.id} className="rounded-lg border border-slate-200 bg-white p-4">
          <Link href={`/orders/${o.id}`} className="block active:bg-slate-50">
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-slate-900 truncate">
                {o.customer_name}
              </div>
              <div className="text-xs text-slate-500 mt-0.5">
                {[o.development, primaryOrderIdentifier(o.order_reference, o.display_id)]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            </div>
            <div className="flex items-center gap-1.5 font-semibold text-slate-900 text-sm">
              {o.isStale && (
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                  Stale
                </span>
              )}
              {formatSGD(o.price_quoted_cents)}
            </div>
          </div>
          <div className="flex items-center justify-between gap-2 mt-3">
            <StatusBadge status={o.current_status} />
            <div className="text-xs text-slate-500">
              Move-in {formatDate(o.move_in_date)}
            </div>
          </div>
          <div className="text-xs text-slate-500 mt-2">
            Product: {productLineLabel(o.product_line)}
          </div>
          {o.consultant_name && (
            <div className="text-xs text-slate-400 mt-2">
              {o.consultant_name}
            </div>
          )}
          </Link>
          {canDelete && (
            <div className="mt-3 flex justify-end border-t border-slate-100 pt-2">
              <DeleteOrderDialog
                orderId={o.id}
                orderIdentifier={primaryOrderIdentifier(
                  o.order_reference,
                  o.display_id,
                )}
                customerName={o.customer_name}
                compact
              />
            </div>
          )}
        </article>
      ))}
      {orders.length === 0 && (
        <div className="text-center py-12 text-sm text-slate-500">
          No orders match your filters.
        </div>
      )}
    </div>
  );
}
