import Link from "next/link";

import type { FulfilmentStatus } from "@/lib/db/schema";
import { formatSGD } from "@/lib/money";

import { StatusBadge } from "./status-badge";

export type OrderRow = {
  id: string;
  display_id: string;
  customer_name: string;
  development: string | null;
  move_in_date: Date | string | null;
  current_status: FulfilmentStatus;
  price_quoted_cents: number;
};

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

export function OrdersTable({ orders }: Props) {
  return (
    <div className="hidden md:block bg-white rounded-lg border border-slate-200 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
          <tr>
            <th className="text-left px-4 py-3 font-medium">Order #</th>
            <th className="text-left px-4 py-3 font-medium">Customer</th>
            <th className="text-left px-4 py-3 font-medium">Development</th>
            <th className="text-left px-4 py-3 font-medium">Move-in</th>
            <th className="text-left px-4 py-3 font-medium">Status</th>
            <th className="text-right px-4 py-3 font-medium">Price</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {orders.map((o) => (
            <tr key={o.id} className="hover:bg-slate-50">
              <td className="px-4 py-3 font-mono text-xs text-slate-500">
                <Link
                  href={`/orders/${o.id}`}
                  className="block hover:text-teal-700"
                >
                  {o.display_id}
                </Link>
              </td>
              <td className="px-4 py-3 font-medium text-slate-900">
                <Link href={`/orders/${o.id}`} className="block">
                  {o.customer_name}
                </Link>
              </td>
              <td className="px-4 py-3 text-slate-600">
                {o.development ?? "—"}
              </td>
              <td className="px-4 py-3 text-slate-600">
                {formatDate(o.move_in_date)}
              </td>
              <td className="px-4 py-3">
                <StatusBadge status={o.current_status} />
              </td>
              <td className="px-4 py-3 text-right font-medium">
                {formatSGD(o.price_quoted_cents)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {orders.length === 0 && (
        <div className="text-center py-12 text-sm text-slate-500">
          No orders match your filters.
        </div>
      )}
    </div>
  );
}
