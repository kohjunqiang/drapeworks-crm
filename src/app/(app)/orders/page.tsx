import Link from "next/link";
import { sql } from "kysely";

import { OrdersCards } from "@/components/orders/orders-cards";
import { OrdersFilters } from "@/components/orders/orders-filters";
import { OrdersStats } from "@/components/orders/orders-stats";
import { OrdersTable, type OrderRow } from "@/components/orders/orders-table";
import { EmptyState } from "@/components/ui/empty-state";
import { db } from "@/lib/db/kysely";
import { STATUS_FLOW } from "@/lib/status-flow";
import type { FulfilmentStatus } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export const metadata = { title: "Orders — Drapeworks CRM" };

function isStatus(s: string | undefined): s is FulfilmentStatus {
  return !!s && (STATUS_FLOW as readonly string[]).includes(s);
}

type SearchParams = {
  q?: string;
  status?: string;
  consultant?: string;
};

export default async function OrdersDashboardPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { q: qRaw, status: statusRaw, consultant: consultantRaw } =
    await searchParams;
  const q = (qRaw ?? "").trim();
  const status = isStatus(statusRaw) ? statusRaw : undefined;
  const consultantId =
    typeof consultantRaw === "string" && consultantRaw.length > 0
      ? consultantRaw
      : undefined;

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
        .filterWhere("current_status", "in", [
          "order_made",
          "sent_logistic",
          "shipping_sg",
        ])
        .as("awaiting_shipment"),
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
      "orders.current_status as current_status",
      "orders.development as development",
      "orders.move_in_date as move_in_date",
      "orders.price_quoted_cents as price_quoted_cents",
      "orders.created_at as created_at",
      "orders.consultant_id as consultant_id",
      "customers.name as customer_name",
      "profiles.full_name as consultant_name",
      "profiles.email as consultant_email",
    ]);

  if (status) listQ = listQ.where("orders.current_status", "=", status);
  if (consultantId) listQ = listQ.where("orders.consultant_id", "=", consultantId);

  if (q) {
    const like = `%${q.replace(/[%_]/g, "")}%`;
    listQ = listQ.where((eb) =>
      eb.or([
        eb("customers.name", "ilike", like),
        eb("customers.mobile", "ilike", like),
        eb("orders.development", "ilike", like),
        eb("orders.display_id", "ilike", like),
      ]),
    );
  }

  const rows = await listQ
    .orderBy("orders.created_at", "desc")
    .limit(50)
    .execute();

  const orders: OrderRow[] = rows.map((r) => ({
    id: r.id,
    display_id: r.display_id,
    customer_name: r.customer_name,
    development: r.development,
    move_in_date: r.move_in_date,
    current_status: r.current_status,
    price_quoted_cents: r.price_quoted_cents,
    consultant_name:
      r.consultant_name?.trim() ||
      (r.consultant_email ? r.consultant_email.split("@")[0] : null),
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
        awaitingShipment={Number(counts.awaiting_shipment)}
        readyForInstallation={Number(counts.ready_for_installation)}
        completedThisMonth={Number(counts.completed_this_month)}
      />

      <OrdersFilters
        defaults={{ q, status, consultant: consultantId }}
        consultants={consultants}
      />

      {orders.length === 0 && !q && !status && !consultantId ? (
        <EmptyState
          title="No orders yet"
          description="Create your first consultation to start tracking measurements, fabrics, and fulfilment."
          cta={{ href: "/orders/new", label: "+ New Consultation" }}
        />
      ) : (
        <>
          <OrdersTable orders={orders} />
          <OrdersCards orders={orders} />
        </>
      )}
    </main>
  );
}
