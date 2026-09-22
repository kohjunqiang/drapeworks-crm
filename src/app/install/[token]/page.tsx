import { notFound } from "next/navigation";
import { z } from "zod";

import { MeshRoomSummaryCard } from "@/components/orders/mesh-room-summary-card";
import { RoomSummaryCard } from "@/components/orders/room-summary-card";
import { db } from "@/lib/db/kysely";
import { isInstallerLinkActive } from "@/lib/fulfilment/installer-link";
import { loadCompletedAt } from "@/lib/fulfilment/load-completed-at";
import { loadRoomSummaries } from "@/lib/orders/load-room-summaries";
import { primaryOrderIdentifier } from "@/lib/orders/reference";

export const dynamic = "force-dynamic";

// Same Singapore rendering as the Installation schedule card on the order
// page: the installer reads this on a phone, in SG time.
const SG_DATETIME = new Intl.DateTimeFormat("en-SG", {
  timeZone: "Asia/Singapore",
  dateStyle: "full",
  timeStyle: "short",
});

const tokenSchema = z.string().uuid();

type Params = { token: string };

export default async function InstallerPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { token } = await params;
  // A malformed token is inactive without spending a query on it.
  const parsed = tokenSchema.safeParse(token);
  if (!parsed.success) notFound();

  const arrangement = await db
    .selectFrom("fulfilment_arrangements")
    .innerJoin("orders", "orders.id", "fulfilment_arrangements.order_id")
    .innerJoin("customers", "customers.id", "orders.customer_id")
    .select([
      "fulfilment_arrangements.order_id",
      "fulfilment_arrangements.scheduled_at",
      "fulfilment_arrangements.duration_mins",
      "fulfilment_arrangements.address",
      "fulfilment_arrangements.cancelled_at",
      "orders.display_id",
      "orders.order_reference",
      "orders.product_line",
      "orders.current_status",
      "customers.name as customer_name",
      "customers.mobile as customer_mobile",
    ])
    .where("fulfilment_arrangements.installer_token", "=", parsed.data)
    .executeTakeFirst();

  if (!arrangement) notFound();

  // The link outlives the job by a fortnight — the window is measured from
  // when the order entered Completed, not the booking time.
  const completedAt =
    arrangement.current_status === "completed"
      ? await loadCompletedAt(arrangement.order_id)
      : null;

  if (
    !isInstallerLinkActive({
      cancelledAt: arrangement.cancelled_at,
      orderStatus: arrangement.current_status,
      completedAt,
    })
  ) {
    notFound();
  }

  const {
    rooms,
    isMesh,
    windowsByRoom,
    panelsByRoom,
    photosByRoom,
    hasInstallationSizes,
  } = await loadRoomSummaries({
    id: arrangement.order_id,
    product_line: arrangement.product_line,
    current_status: arrangement.current_status,
  });

  const reference = primaryOrderIdentifier(
    arrangement.order_reference,
    arrangement.display_id,
  );

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      <section className="mb-4 rounded-lg border border-slate-200 bg-white p-4 sm:p-6">
        <h1 className="text-base font-semibold text-slate-900">
          Installation details
        </h1>
        <p className="mt-0.5 text-xs text-slate-500">Order {reference}</p>
        <p className="mt-3 text-sm font-medium text-slate-900">
          {SG_DATETIME.format(new Date(arrangement.scheduled_at))}
        </p>
        <p className="mt-0.5 text-sm text-slate-500">
          {arrangement.duration_mins} min
        </p>
        <dl className="mt-4 space-y-2 text-sm">
          <div>
            <dt className="text-xs text-slate-500">Address</dt>
            <dd className="text-slate-800">
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(arrangement.address)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-teal-600 underline underline-offset-2 hover:text-teal-700"
              >
                {arrangement.address}
              </a>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Customer</dt>
            <dd className="text-slate-800">{arrangement.customer_name}</dd>
          </div>
          {arrangement.customer_mobile ? (
            <div>
              <dt className="text-xs text-slate-500">Mobile</dt>
              <dd className="text-slate-800">
                <a
                  href={`tel:${arrangement.customer_mobile}`}
                  className="text-teal-600 underline underline-offset-2 hover:text-teal-700"
                >
                  {arrangement.customer_mobile}
                </a>
              </dd>
            </div>
          ) : null}
        </dl>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4 sm:p-6">
        <h2 className="mb-4 text-base font-semibold text-slate-900">
          Rooms &amp; measurements{" "}
          <span className="text-xs font-normal text-slate-500">(cm)</span>
        </h2>
        {hasInstallationSizes && (
          <p className="-mt-2 mb-4 text-xs text-slate-500">
            Measured is the original site measurement. Installation is the
            finalized size confirmed at PO Ready.
          </p>
        )}
        {rooms.length === 0 && (
          <p className="text-sm text-slate-500">No rooms recorded.</p>
        )}
        {rooms.map((r) =>
          isMesh ? (
            <MeshRoomSummaryCard
              key={r.id}
              label={r.label}
              type={r.type}
              panels={panelsByRoom.get(r.id) ?? []}
              photos={photosByRoom.get(r.id) ?? []}
            />
          ) : (
            <RoomSummaryCard
              key={r.id}
              label={r.label}
              type={r.type}
              windows={windowsByRoom.get(r.id) ?? []}
              photos={photosByRoom.get(r.id) ?? []}
            />
          ),
        )}
      </section>
    </main>
  );
}
