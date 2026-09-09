import Link from "next/link";

import type { FulfilmentStatus } from "@/lib/db/schema";
import { formatSGD } from "@/lib/money";
import { primaryOrderIdentifier } from "@/lib/orders/reference";
import {
  SHIPMENT_CATEGORY_LABELS,
  type ShipmentCategory,
} from "@/lib/logistics/shipments";
import { formatFreightAge } from "@/lib/logistics/freight";

import { StatusBadge } from "./status-badge";
import { DeleteOrderDialog } from "./delete-order-dialog";
import { AssignFreightButton, FreightPillButton } from "./freight-manager";
import { shipmentCategoryTone } from "./shipment-presentation";

export type OrderRow = {
  id: string;
  display_id: string;
  order_reference: string | null;
  customer_name: string;
  development: string | null;
  move_in_date: Date | string | null;
  installation_date: Date | string | null;
  current_status: FulfilmentStatus;
  price_quoted_cents: number;
  consultant_name: string | null;
  product_line: "curtain" | "mesh";
  shipments: Array<{
    category: ShipmentCategory;
    freightNumber: string;
    batchStartedAt: string | null;
  }>;
  hasFreightComponents: boolean;
  // True when the calculator has drifted from the locked quote — a nudge to
  // re-quote on the order detail page.
  isStale?: boolean;
};

type Props = {
  orders: OrderRow[];
  canDelete?: boolean;
  sort?: "identifier" | "status";
  direction?: "asc" | "desc";
  sortHrefs?: { identifier: string; status: string };
};

export function productLineLabel(line: "curtain" | "mesh"): string {
  return line === "mesh" ? "Mesh" : "Curtains & Blinds";
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

function SortableHeader({
  label,
  active,
  direction,
  href,
}: {
  label: string;
  active: boolean;
  direction: "asc" | "desc";
  href: string;
}) {
  return (
    <th
      className="px-4 py-3 text-left font-medium"
      aria-sort={active
        ? direction === "asc" ? "ascending" : "descending"
        : "none"}
    >
      <Link
        href={href}
        className="inline-flex items-center gap-1.5 rounded-sm hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
      >
        {label}
        <span aria-hidden="true" className={active ? "text-teal-700" : "text-slate-400"}>
          {active ? direction === "asc" ? "↑" : "↓" : "↕"}
        </span>
        <span className="sr-only">
          Sort {active && direction === "asc" ? "descending" : "ascending"}
        </span>
      </Link>
    </th>
  );
}

export function OrdersTable({
  orders,
  canDelete = false,
  sort,
  direction = "asc",
  sortHrefs = { identifier: "/orders?sort=identifier&dir=asc", status: "/orders?sort=status&dir=asc" },
}: Props) {
  return (
    <div className="hidden overflow-x-auto rounded-lg border border-slate-200 bg-white md:block">
      <table className="w-full min-w-[1360px] text-sm">
        <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
          <tr>
            <SortableHeader
              label="Order / PO #"
              active={sort === "identifier"}
              direction={direction}
              href={sortHrefs.identifier}
            />
            <th className="text-left px-4 py-3 font-medium">Customer</th>
            <th className="text-left px-4 py-3 font-medium">Development</th>
            <th className="text-left px-4 py-3 font-medium">Product</th>
            <th className="min-w-72 px-4 py-3 text-left font-medium">Overseas freight</th>
            <th className="text-left px-4 py-3 font-medium">Move-in</th>
            <th className="text-left px-4 py-3 font-medium">Installation date</th>
            <SortableHeader
              label="Status"
              active={sort === "status"}
              direction={direction}
              href={sortHrefs.status}
            />
            <th className="text-right px-4 py-3 font-medium">Price</th>
            <th className="text-left px-4 py-3 font-medium">Consultant</th>
            {canDelete && <th className="text-right px-4 py-3 font-medium">Actions</th>}
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
                  {primaryOrderIdentifier(o.order_reference, o.display_id)}
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
                {productLineLabel(o.product_line)}
              </td>
              <td className="px-4 py-3 text-slate-600">
                {o.shipments.length === 0 ? (
                  o.hasFreightComponents ? (
                    <AssignFreightButton orderIdentifier={primaryOrderIdentifier(o.order_reference, o.display_id)} />
                  ) : (
                    <span aria-label="No overseas freight numbers">—</span>
                  )
                ) : (
                  <ul className="space-y-1.5" aria-label="Overseas freight numbers">
                    {o.shipments.map((shipment) => (
                      <li
                        key={shipment.category}
                      >
                        <FreightPillButton
                          freightNumber={shipment.freightNumber}
                          ariaLabel={`Open freight ${shipment.freightNumber} for ${SHIPMENT_CATEGORY_LABELS[shipment.category]}`}
                          className={`flex w-fit items-center gap-2 whitespace-nowrap rounded-md border px-2 py-1 text-xs ${shipmentCategoryTone(shipment.category).pill}`}
                        >
                          <span className={`inline-flex items-center gap-1.5 whitespace-nowrap ${shipmentCategoryTone(shipment.category).label}`}>
                            <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${shipmentCategoryTone(shipment.category).dot}`} />
                            {SHIPMENT_CATEGORY_LABELS[shipment.category]}
                          </span>
                          <span className="font-mono font-semibold text-slate-900">{shipment.freightNumber}</span>
                          {shipment.batchStartedAt && (
                            <span className="border-l border-slate-300 pl-2 font-medium text-slate-600">
                              {formatFreightAge(shipment.batchStartedAt)} in transit
                            </span>
                          )}
                        </FreightPillButton>
                      </li>
                    ))}
                  </ul>
                )}
              </td>
              <td className="px-4 py-3 text-slate-600">
                {formatDate(o.move_in_date)}
              </td>
              <td className="px-4 py-3 text-slate-600">
                {formatDate(o.installation_date)}
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
              {canDelete && (
                <td className="px-2 py-3 text-right">
                  <DeleteOrderDialog
                    orderId={o.id}
                    orderIdentifier={primaryOrderIdentifier(
                      o.order_reference,
                      o.display_id,
                    )}
                    customerName={o.customer_name}
                    compact
                  />
                </td>
              )}
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
