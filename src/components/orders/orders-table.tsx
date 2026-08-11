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
  consultant_name: string | null;
  product_line: "curtain" | "mesh";
  // True when the calculator has drifted from the locked quote — a nudge to
  // re-quote on the order detail page.
  isStale?: boolean;
};

type Props = {
  orders: OrderRow[];
};

// Mesh and curtain orders never mix, so the line is a property of the whole
// order — worth showing at a glance rather than hunting through line items.
export function ProductLineBadge({ line }: { line: "curtain" | "mesh" }) {
  if (line === "curtain") return null;
  return (
    <span className="ml-1.5 inline-block px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 text-[10px] font-medium align-middle">
      Mesh
    </span>
  );
}

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
            <th className="text-left px-4 py-3 font-medium">Consultant</th>
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
                <ProductLineBadge line={o.product_line} />
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
                <span className="inline-flex items-center gap-1.5">
                  {o.isStale && (
                    <span
                      title="Pricing changed since quoted — open to re-quote"
                      className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700"
                    >
                      Stale
                    </span>
                  )}
                  {formatSGD(o.price_quoted_cents)}
                </span>
              </td>
              <td className="px-4 py-3 text-slate-600">
                {o.consultant_name ?? "—"}
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
