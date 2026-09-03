import Link from "next/link";
import { sql } from "kysely";

import { OrdersCards } from "@/components/orders/orders-cards";
import { OrdersFilters } from "@/components/orders/orders-filters";
import { OrdersStats } from "@/components/orders/orders-stats";
import { OrdersTable, type OrderRow } from "@/components/orders/orders-table";
import { EmptyState } from "@/components/ui/empty-state";
import { db } from "@/lib/db/kysely";
import { orderStaleFlags } from "@/lib/pricing/order-quote";
import { STATUS_FLOW } from "@/lib/status-flow";
import type { FulfilmentStatus } from "@/lib/db/schema";
import { requireSession } from "@/lib/auth/require-role";

export const dynamic = "force-dynamic";

export const metadata = { title: "Orders — Drapeworks CRM" };

function isStatus(s: string | undefined): s is FulfilmentStatus {
  return !!s && (STATUS_FLOW as readonly string[]).includes(s);
}

type SearchParams = {
  q?: string;
  status?: string;
  consultant?: string;
  product?: string;
  sort?: string;
  dir?: string;
};

type OrderSort = "identifier" | "status";
type SortDirection = "asc" | "desc";

function isOrderSort(value: string | undefined): value is OrderSort {
  return value === "identifier" || value === "status";
}

export default async function OrdersDashboardPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const {
    q: qRaw,
    status: statusRaw,
    consultant: consultantRaw,
    product: productRaw,
    sort: sortRaw,
    dir: directionRaw,
  } = await searchParams;
  const session = await requireSession();
  const q = (qRaw ?? "").trim();
  const status = isStatus(statusRaw) ? statusRaw : undefined;
  const consultantId =
    typeof consultantRaw === "string" && consultantRaw.length > 0
      ? consultantRaw
      : undefined;
  const productLine =
    productRaw === "curtain" || productRaw === "mesh" ? productRaw : undefined;
  const hasExplicitSort = isOrderSort(sortRaw);
  const sort: OrderSort = hasExplicitSort ? sortRaw : "identifier";
  const direction: SortDirection = directionRaw === "desc" ? "desc" : "asc";

  // Stat counts.
  const counts = await db
    .selectFrom("orders")
    .select((eb) => [
      eb.fn.countAll<number>().as("total"),
      eb.fn
        .count<number>("id")
        .filterWhere("current_status", "<>", "completed")
        .as("active"),
      eb.fn
        .count<number>("id")
        // Manufactured or in transit. order_recorded and deposit_received are
        // deliberately excluded: an order with no deposit is not awaiting
        // shipment, which is what the pre-Phase-13 flow got wrong. Both remain
        // in "Active orders" and in the status filter.
        .filterWhere("current_status", "in", [
          "sent_to_vendor",
          "sent_logistic",
          "shipping_sg",
        ])
        .as("awaiting_shipment"),
      eb.fn
        .count<number>("id")
        .filterWhere("current_status", "=", "sent_to_vendor")
        .as("in_production"),
      eb.fn
        .count<number>("id")
        .filterWhere("current_status", "in", [
          "delivered_checked",
          "fulfilment",
        ])
        .as("ready_for_installation"),
      eb.fn
        .count<number>("id")
        .filterWhere((fw) =>
          fw.and([
            fw("current_status", "=", "completed"),
            fw(
              "updated_at",
              ">=",
              sql<Date>`date_trunc('month', now())`,
            ),
          ]),
        )
        .as("completed_this_month"),
    ])
    .executeTakeFirstOrThrow();

  // Orders list with filters. Left join to profiles in case consultant_id is
  // null for legacy/seed rows.
  let listQ = db
    .selectFrom("orders")
    .innerJoin("customers", "customers.id", "orders.customer_id")
    .leftJoin("profiles", "profiles.id", "orders.consultant_id")
    .select([
      "orders.id as id",
      "orders.display_id as display_id",
      "orders.order_reference as order_reference",
      "orders.current_status as current_status",
      "orders.development as development",
      "orders.move_in_date as move_in_date",
      "orders.price_quoted_cents as price_quoted_cents",
      "orders.created_at as created_at",
      "orders.consultant_id as consultant_id",
      "orders.product_line as product_line",
      "customers.name as customer_name",
      "profiles.full_name as consultant_name",
      "profiles.email as consultant_email",
    ]);

  if (status) listQ = listQ.where("orders.current_status", "=", status);
  if (productLine) listQ = listQ.where("orders.product_line", "=", productLine);
  if (consultantId) listQ = listQ.where("orders.consultant_id", "=", consultantId);

  if (q) {
    const like = `%${q.replace(/[%_]/g, "")}%`;
    listQ = listQ.where((eb) =>
      eb.or([
        eb("customers.name", "ilike", like),
        eb("customers.mobile", "ilike", like),
        eb("orders.development", "ilike", like),
        eb("orders.display_id", "ilike", like),
        eb("orders.order_reference", "ilike", like),
      ]),
    );
  }

  if (sort === "identifier") {
    listQ = listQ.orderBy(
      sql<string>`coalesce(nullif(orders.order_reference, ''), orders.display_id)`,
      direction,
    );
  } else if (sort === "status") {
    listQ = listQ.orderBy(sql<number>`case orders.current_status
      when 'order_recorded' then 0
      when 'quotation_sent' then 1
      when 'deposit_received' then 2
      when 'po_ready' then 3
      when 'sent_to_vendor' then 4
      when 'sent_logistic' then 5
      when 'shipping_sg' then 6
      when 'delivered_checked' then 7
      when 'fulfilment' then 8
      when 'completed' then 9
      else 10 end`, direction);
  }

  const rows = await listQ
    .orderBy("orders.created_at", "desc")
    .limit(50)
    .execute();

  // Which of the listed orders have drifted from their locked quote (one
  // batched sweep, not a per-row recompute).
  const staleFlags = await orderStaleFlags(rows.map((r) => r.id));

  const orders: OrderRow[] = rows.map((r) => ({
    id: r.id,
    display_id: r.display_id,
    order_reference: r.order_reference,
    customer_name: r.customer_name,
    development: r.development,
    product_line: r.product_line,
    move_in_date: r.move_in_date,
    current_status: r.current_status,
    price_quoted_cents: r.price_quoted_cents,
    consultant_name:
      r.consultant_name?.trim() ||
      (r.consultant_email ? r.consultant_email.split("@")[0] : null),
    isStale: staleFlags.get(r.id) ?? false,
  }));

  // Distinct consultants present in the orders table (for the filter dropdown).
  const consultantRows = await db
    .selectFrom("orders")
    .innerJoin("profiles", "profiles.id", "orders.consultant_id")
    .select(["profiles.id as id", "profiles.full_name as full_name", "profiles.email as email"])
    .distinct()
    .orderBy("profiles.full_name", "asc")
    .execute();
  const consultants = consultantRows.map((r) => ({
    id: r.id,
    label: r.full_name?.trim() || r.email.split("@")[0],
  }));

  function sortHref(column: OrderSort): string {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (status) params.set("status", status);
    if (consultantId) params.set("consultant", consultantId);
    if (productLine) params.set("product", productLine);
    params.set("sort", column);
    params.set(
      "dir",
      sort === column && direction === "asc" ? "desc" : "asc",
    );
    return `/orders?${params.toString()}`;
  }

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
            Orders
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Consultations and fulfilment in progress
          </p>
        </div>
        <Link
          href="/orders/new"
          className="inline-flex items-center justify-center gap-2 bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded font-medium text-sm"
        >
          <span>+</span> New Consultation
        </Link>
      </div>

      <OrdersStats
        active={Number(counts.active)}
        inProduction={Number(counts.in_production)}
        awaitingShipment={Number(counts.awaiting_shipment)}
        readyForInstallation={Number(counts.ready_for_installation)}
        completedThisMonth={Number(counts.completed_this_month)}
      />

      <OrdersFilters
        defaults={{
          q,
          status,
          consultant: consultantId,
          product: productLine,
          // Keep the clean /orders URL clean. With no explicit sort params the
          // server still applies the default Order / PO ascending order.
          sort: hasExplicitSort ? sort : undefined,
          dir: hasExplicitSort ? direction : undefined,
        }}
        consultants={consultants}
      />

      {orders.length === 0 && !q && !status && !consultantId && !productLine ? (
        <EmptyState
          title="No orders yet"
          description="Create your first consultation to start tracking measurements, fabrics, and fulfilment."
          cta={{ href: "/orders/new", label: "+ New Consultation" }}
        />
      ) : (
        <>
          <OrdersTable
            orders={orders}
            canDelete={session.profile.role === "admin"}
            sort={sort}
            direction={direction}
            sortHrefs={{
              identifier: sortHref("identifier"),
              status: sortHref("status"),
            }}
          />
          <OrdersCards orders={orders} canDelete={session.profile.role === "admin"} />
        </>
      )}
    </main>
  );
}
