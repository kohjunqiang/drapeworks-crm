import Link from "next/link";
import { sql } from "kysely";

import { OrdersCards } from "@/components/orders/orders-cards";
import { OrdersFilters } from "@/components/orders/orders-filters";
import { OrdersStats } from "@/components/orders/orders-stats";
import { OrdersTable, type OrderRow } from "@/components/orders/orders-table";
import {
  FreightManagerProvider,
  ManageFreightButton,
  type FreightComponent,
} from "@/components/orders/freight-manager";
import { EmptyState } from "@/components/ui/empty-state";
import { db } from "@/lib/db/kysely";
import { orderStaleFlags } from "@/lib/pricing/order-quote";
import { shipmentItemLabels, type ShipmentItemWindow } from "@/lib/logistics/shipment-items";
import { SHIPMENT_CATEGORIES } from "@/lib/logistics/shipments";
import {
  normalizeFreightNumber,
  usableFreightNumber,
} from "@/lib/logistics/freight";
import { primaryOrderIdentifier } from "@/lib/orders/reference";
import { STATUS_FLOW } from "@/lib/status-flow";
import type { FulfilmentStatus } from "@/lib/db/schema";
import { requireSession } from "@/lib/auth/require-role";
import {
  ACTIVE_ORDER_STATUSES,
  AWAITING_BALANCE_STATUSES,
  AWAITING_SHIPMENT_STATUSES,
  DEFAULT_ORDER_LIST_STATUSES,
  IN_PRODUCTION_STATUSES,
  READY_FOR_INSTALLATION_STATUSES,
} from "@/lib/orders/dashboard-stats";

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
  zohoAttention?: string;
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
    zohoAttention: zohoAttentionRaw,
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
  const zohoAttention = zohoAttentionRaw === "1";

  // Stat counts.
  const counts = await db
    .selectFrom("orders")
    .select((eb) => [
      eb.fn.countAll<number>().as("total"),
      eb.fn
        .count<number>("id")
        .filterWhere("current_status", "in", [...ACTIVE_ORDER_STATUSES])
        .as("active"),
      eb.fn
        .count<number>("id")
        // Already handed to logistics or currently in transit. Production is
        // a separate card, so sent_to_vendor must not overlap this count.
        .filterWhere("current_status", "in", [...AWAITING_SHIPMENT_STATUSES])
        .as("awaiting_shipment"),
      eb.fn
        .count<number>("id")
        .filterWhere("current_status", "in", [...IN_PRODUCTION_STATUSES])
        .as("in_production"),
      eb.fn
        .count<number>("id")
        .filterWhere("current_status", "in", [
          ...READY_FOR_INSTALLATION_STATUSES,
        ])
        .as("ready_for_installation"),
      eb.fn.count<number>("id")
        .filterWhere("current_status", "in", [...AWAITING_BALANCE_STATUSES])
        .as("awaiting_balance"),
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
    .leftJoin("fulfilment_arrangements", (join) =>
      join
        .onRef("fulfilment_arrangements.order_id", "=", "orders.id")
        .on("fulfilment_arrangements.cancelled_at", "is", null),
    )
    .select([
      "orders.id as id",
      "orders.display_id as display_id",
      "orders.order_reference as order_reference",
      "orders.current_status as current_status",
      "orders.development as development",
      "orders.move_in_date as move_in_date",
      "fulfilment_arrangements.scheduled_at as installation_date",
      "orders.price_quoted_cents as price_quoted_cents",
      "orders.created_at as created_at",
      "orders.consultant_id as consultant_id",
      "orders.product_line as product_line",
      "customers.name as customer_name",
      "profiles.full_name as consultant_name",
      "profiles.email as consultant_email",
    ]);

  if (status) {
    listQ = listQ.where("orders.current_status", "=", status);
  } else {
    listQ = listQ.where("orders.current_status", "in", [
      ...DEFAULT_ORDER_LIST_STATUSES,
    ]);
  }
  if (productLine) listQ = listQ.where("orders.product_line", "=", productLine);
  if (consultantId) listQ = listQ.where("orders.consultant_id", "=", consultantId);
  if (zohoAttention) {
    listQ = listQ.where(sql<boolean>`exists (
      select 1 from public.order_quotations oq
      where oq.order_id = orders.id and oq.superseded_at is null
        and (oq.status in ('syncing','sending','sync_failed','conflict')
          or oq.invoice_sync_state in ('pending','failed','uncertain')
          or oq.payment_sync_state in ('pending','failed','uncertain'))
    )`);
  }

  if (q) {
    const like = `%${q.replace(/[%_]/g, "")}%`;
    listQ = listQ.where((eb) =>
      eb.or([
        eb("customers.name", "ilike", like),
        eb("customers.mobile", "ilike", like),
        eb("orders.development", "ilike", like),
        eb("orders.display_id", "ilike", like),
        eb("orders.order_reference", "ilike", like),
        sql<boolean>`exists (
          select 1 from public.order_shipments os
          where os.order_id = orders.id
            and os.overseas_freight_number ilike ${like}
        )`,
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
      when 'installation_completed' then 9
      when 'completed' then 10
      else 11 end`, direction);
  }

  const rows = await listQ
    .orderBy("orders.created_at", "desc")
    .limit(50)
    .execute();

  let freightQuery = db.selectFrom("order_shipments")
    .innerJoin("orders", "orders.id", "order_shipments.order_id")
    .innerJoin("customers", "customers.id", "orders.customer_id")
    .select([
      "order_shipments.order_id",
      "order_shipments.category",
      "order_shipments.not_needed",
      "order_shipments.overseas_freight_number",
      "order_shipments.overseas_freight_assigned_at",
      "order_shipments.arrived_checked_at",
      "order_shipments.updated_at",
      "orders.display_id",
      "orders.order_reference",
      "orders.current_status",
      "orders.development",
      "customers.name as customer_name",
    ]);
  freightQuery = rows.length > 0
    ? freightQuery.where((eb) => eb.or([
        eb("orders.current_status", "in", [...ACTIVE_ORDER_STATUSES]),
        eb("orders.id", "in", rows.map((row) => row.id)),
      ]))
    : freightQuery.where("orders.current_status", "in", [...ACTIVE_ORDER_STATUSES]);
  const freightRows = await freightQuery
    .orderBy("orders.created_at", "desc")
    .execute();

  const batchStartedAt = new Map<string, string>();
  for (const shipment of freightRows) {
    const freightNumber = usableFreightNumber(shipment.overseas_freight_number);
    const assignedAt = shipment.overseas_freight_assigned_at;
    if (!freightNumber || !assignedAt) continue;
    const key = normalizeFreightNumber(freightNumber);
    const iso = new Date(assignedAt).toISOString();
    const current = batchStartedAt.get(key);
    if (!current || iso < current) batchStartedAt.set(key, iso);
  }

  // One bounded lookup for the visible orders, rather than a query per row.
  const itemWindows = rows.length ? await db.selectFrom("windows")
    .innerJoin("rooms", "rooms.id", "windows.room_id")
    .leftJoin("curtain_types as blind_type", "blind_type.id", "windows.blind_type_id")
    .leftJoin("curtain_series as blind_series", "blind_series.id", "blind_type.series_id")
    .select(["rooms.order_id", "windows.day_curtain_type_id", "windows.night_curtain_type_id",
      "windows.blind_type_id", "blind_series.name as blind_series"])
    .where("rooms.order_id", "in", rows.map((row) => row.id))
    .execute() : [];
  const windowsByOrder = new Map<string, ShipmentItemWindow[]>();
  for (const window of itemWindows) {
    const windows = windowsByOrder.get(window.order_id) ?? [];
    windows.push(window);
    windowsByOrder.set(window.order_id, windows);
  }

  const visibleOrderIds = new Set(rows.map((row) => row.id));
  const categoryOrder = new Map(
    SHIPMENT_CATEGORIES.map((category, index) => [category, index]),
  );
  const shipmentsByOrder = new Map<string, OrderRow["shipments"]>();
  for (const shipment of freightRows) {
    if (!visibleOrderIds.has(shipment.order_id)) continue;
    const freightNumber = usableFreightNumber(shipment.overseas_freight_number);
    const orderShipments = shipmentsByOrder.get(shipment.order_id) ?? [];
    for (const label of shipmentItemLabels(shipment.category, windowsByOrder.get(shipment.order_id) ?? [])) {
      orderShipments.push({
        label,
        notNeeded: shipment.not_needed,
        category: shipment.category,
        freightNumber,
        batchStartedAt:
          freightNumber ? batchStartedAt.get(normalizeFreightNumber(freightNumber)) ?? null : null,
        arrivedCheckedAt: shipment.arrived_checked_at
          ? new Date(shipment.arrived_checked_at).toISOString()
          : null,
      });
    }
    shipmentsByOrder.set(shipment.order_id, orderShipments);
  }
  for (const shipments of shipmentsByOrder.values()) {
    shipments.sort(
      (a, b) =>
        (categoryOrder.get(a.category) ?? 99) -
        (categoryOrder.get(b.category) ?? 99),
    );
  }

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
    installation_date: r.installation_date,
    current_status: r.current_status,
    price_quoted_cents: r.price_quoted_cents,
    consultant_name:
      r.consultant_name?.trim() ||
      (r.consultant_email ? r.consultant_email.split("@")[0] : null),
    shipments: shipmentsByOrder.get(r.id) ?? [],
    hasFreightComponents: freightRows.some((shipment) => shipment.order_id === r.id),
    isStale: staleFlags.get(r.id) ?? false,
  }));

  const freightComponents: FreightComponent[] = freightRows.map((shipment) => ({
    orderId: shipment.order_id,
    orderIdentifier: primaryOrderIdentifier(
      shipment.order_reference,
      shipment.display_id,
    ),
    customerName: shipment.customer_name,
    development: shipment.development,
    category: shipment.category,
    notNeeded: shipment.not_needed,
    freightNumber: usableFreightNumber(shipment.overseas_freight_number),
    freightAssignedAt: shipment.overseas_freight_assigned_at
      ? new Date(shipment.overseas_freight_assigned_at).toISOString()
      : null,
    arrivedCheckedAt: shipment.arrived_checked_at
      ? new Date(shipment.arrived_checked_at).toISOString()
      : null,
    updatedAt: new Date(shipment.updated_at).toISOString(),
    currentStatus: shipment.current_status,
    assignable:
      ["sent_to_vendor", "sent_logistic", "shipping_sg"].includes(
        shipment.current_status,
      ) && !shipment.arrived_checked_at && !shipment.not_needed,
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
    if (zohoAttention) params.set("zohoAttention", "1");
    params.set("sort", column);
    params.set(
      "dir",
      sort === column && direction === "asc" ? "desc" : "asc",
    );
    return `/orders?${params.toString()}`;
  }

  function completedHref(): string {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    params.set("status", "completed");
    if (consultantId) params.set("consultant", consultantId);
    if (productLine) params.set("product", productLine);
    if (hasExplicitSort) {
      params.set("sort", sort);
      params.set("dir", direction);
    }
    return `/orders?${params.toString()}`;
  }

  return (
    <FreightManagerProvider
      components={freightComponents}
      canManage={session.profile.role === "ops" || session.profile.role === "admin"}
      referenceTime={new Date().toISOString()}
    >
    <main className="mx-auto max-w-[1536px] px-4 py-6 sm:px-6 sm:py-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
            Orders
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Consultations and fulfilment in progress
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(session.profile.role === "ops" || session.profile.role === "admin") && (
            <ManageFreightButton />
          )}
          <Link
            href="/orders/new"
            className="inline-flex h-9 items-center justify-center gap-2 rounded bg-teal-600 px-4 text-sm font-medium text-white hover:bg-teal-700"
          >
            <span>+</span> New Consultation
          </Link>
        </div>
      </div>

      {zohoAttention && (
        <div className="mb-5 flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 sm:flex-row sm:items-center sm:justify-between">
          <span>Showing orders with interrupted or failed Zoho quotation/invoice work.</span>
          <Link href="/orders" className="font-medium underline">Clear Zoho attention filter</Link>
        </div>
      )}

      <OrdersStats
        active={Number(counts.active)}
        inProduction={Number(counts.in_production)}
        awaitingShipment={Number(counts.awaiting_shipment)}
        readyForInstallation={Number(counts.ready_for_installation)}
        awaitingBalance={Number(counts.awaiting_balance)}
        completedThisMonth={Number(counts.completed_this_month)}
        completedHref={completedHref()}
      />

      <OrdersFilters
        key={JSON.stringify({ status, consultantId, productLine, sort, direction })}
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

      {orders.length === 0 && !q && !status && !consultantId && !productLine && !zohoAttention ? (
        <EmptyState
          title="No current orders"
          description="Current orders will appear here. Use the status filter to view completed or earlier workflow stages."
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
    </FreightManagerProvider>
  );
}
