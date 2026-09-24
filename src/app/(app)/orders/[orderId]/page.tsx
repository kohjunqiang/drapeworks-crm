import Link from "next/link";
import { notFound } from "next/navigation";

import { AdvanceStatusButton } from "@/components/orders/advance-status-button";
import { CompletionPhotoUploader } from "@/components/orders/completion-photo-uploader";
import { DeleteOrderDialog } from "@/components/orders/delete-order-dialog";
import { DeliveryNumbersCard } from "@/components/orders/delivery-numbers-card";
import { EditPaymentDialog } from "@/components/orders/edit-payment-dialog";
import { FulfilmentArrangementCard } from "@/components/orders/fulfilment-arrangement-card";
import { OrderReferenceField } from "@/components/orders/order-reference-field";
import { PrintButton } from "@/components/orders/print-button";
import { QuoteCard } from "@/components/orders/quote-card";
import { QuotationWorkspace } from "@/components/orders/quotation-workspace";
import { RoomOrderControls } from "@/components/orders/room-order-controls";
import { RoomSummaryCard } from "@/components/orders/room-summary-card";
import { MeshRoomSummaryCard } from "@/components/orders/mesh-room-summary-card";
import { StatusBadge } from "@/components/orders/status-badge";
import { StatusTimeline } from "@/components/orders/status-timeline";
import {
  STATUS_FLOW,
  STATUS_LABELS,
  isLocked,
  statusIndex,
} from "@/lib/status-flow";
import { requireSession } from "@/lib/auth/require-role";
import { isCalendarConfigured } from "@/lib/calendar/google";
import { signCompletionPhotoUrls } from "@/lib/db/completion-photos";
import { db } from "@/lib/db/kysely";
import { loadInstallationSummary } from "@/lib/fulfilment/load-installation-summary";
import { canScheduleInstallation } from "@/lib/fulfilment/status";
import { loadOrderShipmentState } from "@/lib/logistics/load";
import { requiresLocalDelivery } from "@/lib/logistics/shipments";
import { loadRoomSummaries } from "@/lib/orders/load-room-summaries";
import { formatSGD } from "@/lib/money";
import { primaryOrderIdentifier } from "@/lib/orders/reference";
import { panelBillableArea } from "@/lib/pricing/mesh-calculator";
import { computeOrderQuote } from "@/lib/pricing/order-quote";
import { isZohoBooksConfigured } from "@/lib/zoho/books";
import type { QuotationLineInput } from "@/lib/validation/quotation";
import { buildFabricSelectionNotes } from "@/lib/quotations/fabric-notes";
import { quotationDateOnly } from "@/lib/quotations/model";

export const dynamic = "force-dynamic";

export const metadata = { title: "Order — Drapeworks CRM" };

const SG_DATE = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

function formatDate(d: Date | string | null): string {
  if (!d) return "—";
  return SG_DATE.format(new Date(d));
}

type Params = { orderId: string };

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { orderId } = await params;
  const session = await requireSession();

  const order = await db
    .selectFrom("orders")
    .innerJoin("customers", "customers.id", "orders.customer_id")
    .leftJoin("profiles", "profiles.id", "orders.consultant_id")
    .select([
      "orders.id as id",
      "orders.display_id as display_id",
      "orders.order_reference as order_reference",
      "orders.consultant_id as consultant_id",
      "orders.product_line as product_line",
      "orders.current_status as current_status",
      "orders.is_draft as is_draft",
      "orders.property_type as property_type",
      "orders.development as development",
      "orders.site_address as site_address",
      "orders.unit_type as unit_type",
      "orders.move_in_date as move_in_date",
      "orders.price_quoted_cents as price_quoted_cents",
      "orders.deposit_cents as deposit_cents",
      "orders.balance_cents as balance_cents",
      "orders.general_notes as general_notes",
      "orders.created_at as created_at",
      "customers.id as customer_id",
      "customers.name as customer_name",
      "customers.mobile as customer_mobile",
      "customers.email as customer_email",
      "profiles.full_name as consultant_name",
      "profiles.email as consultant_email",
    ])
    .where("orders.id", "=", orderId)
    .executeTakeFirst();

  if (!order) notFound();

  const currentQuotation = await db
    .selectFrom("order_quotations")
    .selectAll()
    .where("order_id", "=", order.id)
    .where("superseded_at", "is", null)
    .executeTakeFirst();

  const [quotationHistory, quotationVersions, zohoCustomerLink] = await Promise.all([
    db.selectFrom("order_quotations").select(["id", "revision", "zoho_estimate_number", "sent_at", "superseded_at", "quoted_total_cents", "pdf_storage_path"]).where("order_id", "=", order.id).where("superseded_at", "is not", null).orderBy("revision", "desc").execute(),
    currentQuotation
      ? db.selectFrom("order_quotation_versions").select(["id", "version", "quoted_total_cents", "pdf_storage_path", "created_at"]).where("quotation_id", "=", currentQuotation.id).orderBy("version", "desc").execute()
      : Promise.resolve([]),
    db.selectFrom("customer_zoho_links").select("zoho_contact_id").where("customer_id", "=", order.customer_id).executeTakeFirst(),
  ]);

  const shipmentState =
    statusIndex(order.current_status) >= statusIndex("sent_to_vendor")
      ? await loadOrderShipmentState(db, order.id)
      : { categories: [], shipments: [] };

  // The rooms/windows/panels/photos assembly is shared with the public
  // installer page; the raw rows stay available for the fabric-selection
  // notes and the mesh area breakdown below.
  const {
    rooms,
    isMesh,
    windows,
    meshPanels,
    meshBook,
    addonsByWindow,
    windowsByRoom,
    panelsByRoom,
    photosByRoom,
    hasInstallationSizes,
  } = await loadRoomSummaries(order);

  const roomLabels = new Map(rooms.map((room) => [room.id, room.label]));
  const meshAreaBreakdown =
    isMesh && meshBook
      ? meshPanels.flatMap((panel) => {
          const area = panelBillableArea(
            {
              categoryId: panel.category_id,
              colourId: panel.colour_id,
              widthCm: panel.width_cm,
              heightCm: panel.height_cm,
              draw: panel.draw ?? null,
            },
            meshBook,
          );
          if (!area || panel.width_cm == null || panel.height_cm == null) {
            return [];
          }
          return [{
            label: `${roomLabels.get(panel.room_id) ?? "Room"} · Panel ${panel.position + 1}`,
            dimensions: `${panel.width_cm} × ${panel.height_cm} cm`,
            measuredSqm: area.actualCm2 / 10_000,
            // Mesh pricing rounds every panel up to the next 0.1 m², so the
            // displayed total must use the same per-panel rounding as the
            // recommendation rather than rounding only after summing.
            billableSqm: Math.ceil(area.billableCm2 / 1_000) / 10,
          }];
        })
      : undefined;

  // Prefill a new quotation's Notes with the fabric selections in the shape
  // the team types into Zoho Books by hand. Existing quotations keep their
  // stored notes; this is only the empty-draft default ("" for mesh orders,
  // which load no windows).
  const defaultQuotationNotes = buildFabricSelectionNotes({
    rooms,
    windows: windows.map((w) => ({
      roomId: w.room_id,
      dayLabel: w.day_curtain_label,
      dayPage: w.day_curtain_page,
      nightLabel: w.night_curtain_label,
      blindLabel: w.blind_label,
      overlapTracksAttachment: w.overlap_tracks_attachment,
      addons: addonsByWindow.get(w.id) ?? [],
    })),
  });

  const events = await db
    .selectFrom("order_status_events")
    .select(["id", "status", "note", "created_at"])
    .where("order_id", "=", order.id)
    .orderBy("created_at", "desc")
    .execute();

  const arrangement =
    canScheduleInstallation(order.current_status)
      ? await db
          .selectFrom("fulfilment_arrangements")
          .select([
            "scheduled_at",
            "duration_mins",
            "address",
            "google_event_id",
            "google_sync_state",
            "google_sync_error",
            "cancelled_at",
            "cancellation_reason",
            "installer_token",
          ])
          .where("order_id", "=", order.id)
          .executeTakeFirst()
      : undefined;
  const installationSummary = arrangement && !arrangement.cancelled_at
    ? await loadInstallationSummary(
        order.id,
        arrangement.scheduled_at,
        arrangement.duration_mins,
        arrangement.address,
        arrangement.installer_token,
      )
    : null;

  // Once the order is with the vendor the consultation is frozen. The date
  // comes from the EARLIEST sent_to_vendor event: an admin amendment writes a
  // second event at the same status, and "locked on" means when it happened,
  // not when it was last touched.
  const locked = isLocked(order.current_status);
  const canReorderRooms =
    !locked &&
    (session.profile.role === "admin" ||
      order.consultant_id === session.user.id);
  const lockedAt = locked
    ? (events
        .filter((e) => e.status === "sent_to_vendor")
        .reduce<Date | null>((earliest, e) => {
          const at = new Date(e.created_at);
          return earliest && earliest <= at ? earliest : at;
        }, null) ?? null)
    : null;

  const completionPhotoRows = await db
    .selectFrom("order_completion_photos")
    .select(["id", "storage_path", "original_name"])
    .where("order_id", "=", order.id)
    .orderBy("position", "asc")
    .orderBy("created_at", "asc")
    .execute();
  const completionPhotoUrls = await signCompletionPhotoUrls(
    completionPhotoRows.map((photo) => photo.storage_path),
  );
  const completionPhotos = completionPhotoRows.flatMap((photo) => {
    const signedUrl = completionPhotoUrls.get(photo.storage_path);
    return signedUrl
      ? [{ id: photo.id, signedUrl, originalName: photo.original_name }]
      : [];
  });

  // Auto-calculated quote from the priced series + window add-ons (null until
  // the order's curtains are priced).
  const quote = await computeOrderQuote(order.id);

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <div className="text-xs text-slate-500 mb-3">
        <Link href="/orders" className="hover:text-slate-700">
          Orders
        </Link>
        <span className="mx-1">/</span>
        <span className="text-slate-700">{order.display_id}</span>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between mb-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
              {order.customer_name}
            </h1>
            <StatusBadge status={order.current_status} />
          </div>
          <div className="text-sm text-slate-500 mt-1">
            {[order.development, order.unit_type]
              .filter(Boolean)
              .join(" · ")}
            {(order.development || order.unit_type) && " · "}
            {order.move_in_date && `Move-in ${formatDate(order.move_in_date)} · `}
            {order.order_reference
              ? `PO ${order.order_reference}`
              : `Order ${order.display_id}`}
          </div>
          {locked && (
            <div
              title={order.current_status === "po_ready"
                ? "The manufacturing measurements are finalized. Review the vendor POs before sending the order."
                : `This order is at "${STATUS_LABELS[order.current_status]}". The consultation cannot be edited once it has gone to the vendor.`}
              className="mt-2 text-xs text-slate-500"
            >
              {order.current_status === "po_ready"
                ? "🔒 Measurements finalized"
                : "🔒 Sent to vendor"}
              {lockedAt && ` on ${formatDate(lockedAt)}`}
            </div>
          )}
        </div>
        {(() => {
          const canEdit =
            !locked &&
            (session.profile.role === "admin" ||
              order.consultant_id === session.user.id);
          const isAdvancer =
            session.profile.role === "ops" ||
            session.profile.role === "admin";
          const currentIdx = statusIndex(order.current_status);
          const atEnd = currentIdx === STATUS_FLOW.length - 1;
          const nextLabel = atEnd
            ? undefined
            : STATUS_LABELS[STATUS_FLOW[currentIdx + 1]];
          const ctaLabel =
            order.current_status === "order_recorded"
              ? "Mark quotation sent"
              : order.current_status === "quotation_sent"
                ? "Create invoice & record deposit"
                : order.current_status === "sent_to_vendor"
                  ? shipmentState.shipments.length > 0 &&
                      !shipmentState.shipments.some((shipment) =>
                        requiresLocalDelivery(shipment.category))
                    ? "Continue — direct shipments"
                    : "Send to logistic partner"
                  : order.current_status === "sent_logistic"
                    ? "Mark shipping to SG"
                    : order.current_status === "shipping_sg"
                      ? "Mark Delivered & Checked"
                    : order.current_status === "delivered_checked" &&
                        arrangement && !arrangement.cancelled_at
                      ? "Confirm installation arrangement"
                    : undefined;
          // Recording the deposit exists to unblock the measurements review, so
          // go straight there rather than returning to this page and asking for
          // a second click to do the thing the first click was for.
          const advanceTo =
            order.current_status === "quotation_sent"
              ? `/orders/${order.id}/manufacture`
              : undefined;

          // A locked order still renders the row, so a consultant who can no
          // longer edit is told why rather than shown an empty header.
          if (!canEdit && !isAdvancer && !locked) return null;

          return (
            <div className="flex flex-wrap items-center gap-2">
              {canEdit && (
                <Link
                  href={`/orders/${order.id}/edit`}
                  className="px-3 py-1.5 text-xs sm:text-sm border border-slate-300 rounded hover:bg-white"
                >
                  Edit
                </Link>
              )}
              {/* The manufacturing set is derived once the deposit is in, and
                  stays readable forever after. Ops and admin only — it is the
                  screen that hands the order to a vendor. */}
              {isAdvancer &&
                order.current_status === "deposit_received" && (
                  <Link
                    href={`/orders/${order.id}/manufacture`}
                    className="rounded bg-orange-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-orange-700 sm:text-sm"
                  >
                    Review manufacturing measurements
                  </Link>
                )}
              {isAdvancer && order.current_status === "po_ready" && (
                <Link
                  href={`/orders/${order.id}/manufacture`}
                  className="rounded bg-orange-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-orange-700 sm:text-sm"
                >
                  Next: Review &amp; send to vendor →
                </Link>
              )}
              {isAdvancer &&
                isLocked(order.current_status) &&
                order.current_status !== "po_ready" && (
                <Link
                  href={`/orders/${order.id}/manufacture`}
                  className="px-3 py-1.5 text-xs sm:text-sm border border-slate-300 rounded hover:bg-white"
                >
                  View vendor POs
                </Link>
              )}
              <PrintButton />
              {isAdvancer &&
                !order.is_draft &&
                order.current_status !== "order_recorded" &&
                order.current_status !== "deposit_received" &&
                order.current_status !== "po_ready" &&
                (order.current_status !== "shipping_sg" ||
                  shipmentState.shipments.length === 0) &&
                (order.current_status !== "delivered_checked" ||
                  Boolean(arrangement && !arrangement.cancelled_at)) && (
                <AdvanceStatusButton
                  orderId={order.id}
                  currentStatus={order.current_status}
                  atEnd={atEnd}
                  nextLabel={nextLabel}
                  ctaLabel={ctaLabel}
                  advanceTo={advanceTo}
                  completionPhotos={completionPhotos}
                  shipments={shipmentState.shipments}
                  manifestRecoveryHref={`/orders/${order.id}/manufacture`}
                  invoiceTotalCents={order.price_quoted_cents}
                  depositCents={order.deposit_cents}
                />
              )}
              {session.profile.role === "admin" && (
                <DeleteOrderDialog
                  orderId={order.id}
                  orderIdentifier={primaryOrderIdentifier(
                    order.order_reference,
                    order.display_id,
                  )}
                  customerName={order.customer_name}
                />
              )}
            </div>
          );
        })()}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-6">
        <div className="lg:col-span-2 space-y-4 order-1">
          {!order.is_draft && (
            <QuotationWorkspace
              key={`${currentQuotation ? `${currentQuotation.id}:${new Date(currentQuotation.updated_at).toISOString()}` : "new"}:${order.current_status}`}
              orderId={order.id}
              displayId={order.order_reference || order.display_id}
              customerName={order.customer_name}
              productLine={order.product_line}
              quotedCents={order.price_quoted_cents}
              defaultNotes={defaultQuotationNotes}
              depositCents={order.deposit_cents}
              quote={currentQuotation ? {
                id: currentQuotation.id,
                revision: currentQuotation.revision,
                status: currentQuotation.status,
                issueDate: quotationDateOnly(currentQuotation.issue_date),
                expiryDate: quotationDateOnly(currentQuotation.expiry_date),
                lines: currentQuotation.lines as unknown as QuotationLineInput[],
                totalCents: currentQuotation.quoted_total_cents,
                customerMessage: currentQuotation.customer_message,
                notes: currentQuotation.notes ?? "",
                terms: currentQuotation.terms ?? "",
                estimateNumber: currentQuotation.zoho_estimate_number,
                invoiceNumber: currentQuotation.zoho_invoice_number,
                invoiceSyncState: currentQuotation.invoice_sync_state,
                invoiceSyncError: currentQuotation.invoice_sync_error,
                paymentNumber: currentQuotation.zoho_payment_number,
                paymentSyncState: currentQuotation.payment_sync_state,
                paymentSyncError: currentQuotation.payment_sync_error,
                hasZohoEstimate: Boolean(currentQuotation.zoho_estimate_id),
                hasZohoInvoice: Boolean(currentQuotation.zoho_invoice_id),
                updatedAt: new Date(currentQuotation.updated_at).toISOString(),
                syncError: currentQuotation.sync_error,
                hasPdf: Boolean(currentQuotation.pdf_storage_path),
                sentAt: currentQuotation.sent_at ? new Date(currentQuotation.sent_at).toISOString() : null,
              } : null}
              versions={quotationVersions.map((item) => ({ id: item.id, version: item.version, totalCents: Number(item.quoted_total_cents), createdAt: new Date(item.created_at).toISOString(), hasPdf: Boolean(item.pdf_storage_path) }))}
              history={quotationHistory.map((item) => ({
                id: item.id,
                revision: item.revision,
                estimateNumber: item.zoho_estimate_number,
                sentAt: item.sent_at ? new Date(item.sent_at).toISOString() : null,
                supersededAt: item.superseded_at ? new Date(item.superseded_at).toISOString() : null,
                totalCents: item.quoted_total_cents,
                hasPdf: Boolean(item.pdf_storage_path),
              }))}
              linkedContactId={zohoCustomerLink?.zoho_contact_id ?? null}
              quotationStageComplete={
                statusIndex(order.current_status) > statusIndex("quotation_sent")
              }
              canManage={(order.current_status === "order_recorded" || order.current_status === "quotation_sent") && (session.profile.role === "admin" || (session.profile.role === "consultant" && order.consultant_id === session.user.id))}
              canRepairDeposit={order.current_status === "deposit_received" && (session.profile.role === "admin" || session.profile.role === "ops")}
              configured={await isZohoBooksConfigured()}
            />
          )}
          {statusIndex(order.current_status) >= statusIndex("sent_to_vendor") && (
            <DeliveryNumbersCard
              orderId={order.id}
              currentStatus={order.current_status}
              canEdit={session.profile.role === "ops" || session.profile.role === "admin"}
              canReopenArrival={session.profile.role === "admin"}
              shipments={shipmentState.shipments}
            />
          )}
          {canScheduleInstallation(order.current_status) && (
            <FulfilmentArrangementCard
              orderId={order.id}
              arrangement={arrangement ?? null}
              summaryText={installationSummary?.text ?? null}
              installerUrl={installationSummary?.installerUrl ?? null}
              defaultAddress={order.site_address ?? ""}
              canManage={
                order.current_status !== "completed" &&
                (session.profile.role === "ops" || session.profile.role === "admin")
              }
              canRetrySync={
                session.profile.role === "ops" || session.profile.role === "admin"
              }
              canResetLink={
                session.profile.role === "ops" || session.profile.role === "admin"
              }
              calendarConfigured={isCalendarConfigured()}
            />
          )}
          <StatusTimeline
            orderId={order.id}
            currentStatus={order.current_status}
            events={events}
            canAddNote={
              session.profile.role !== "consultant" ||
              order.consultant_id === session.user.id
            }
            canRevert={session.profile.role === "admin"}
          />

          {["installation_completed", "completed"].includes(order.current_status) && (
            <section className="rounded-lg border border-slate-200 bg-white p-4 sm:p-6">
              <h2 className="mb-1 text-base font-semibold text-slate-900">
                Completed photos
              </h2>
              <p className="mb-4 text-xs text-slate-500">
                Photos of the finished installation.
              </p>
              <CompletionPhotoUploader
                orderId={order.id}
                photos={completionPhotos}
                readOnly={session.profile.role !== "ops" && session.profile.role !== "admin"}
              />
            </section>
          )}

          <section className="bg-white rounded-lg border border-slate-200 p-4 sm:p-6">
            <h2 className="text-base font-semibold text-slate-900 mb-4">
              Rooms &amp; measurements{" "}
              <span className="text-xs font-normal text-slate-500">(cm)</span>
            </h2>
            {hasInstallationSizes && (
              <p className="text-xs text-slate-500 -mt-2 mb-4">
                Measured is the original site measurement. Installation is the
                finalized size confirmed at PO Ready.
              </p>
            )}
            {rooms.length === 0 && (
              <p className="text-sm text-slate-500">No rooms recorded.</p>
            )}
            {rooms.map((r, roomIndex) =>
              isMesh ? (
                <MeshRoomSummaryCard
                  key={r.id}
                  label={r.label}
                  type={r.type}
                  panels={panelsByRoom.get(r.id) ?? []}
                  photos={photosByRoom.get(r.id) ?? []}
                  orderControls={canReorderRooms ? (
                    <RoomOrderControls
                      orderId={order.id}
                      roomId={r.id}
                      roomLabel={r.label}
                      canMoveUp={roomIndex > 0}
                      canMoveDown={roomIndex < rooms.length - 1}
                    />
                  ) : undefined}
                />
              ) : (
                <RoomSummaryCard
                  key={r.id}
                  label={r.label}
                  type={r.type}
                  windows={windowsByRoom.get(r.id) ?? []}
                  photos={photosByRoom.get(r.id) ?? []}
                  orderControls={canReorderRooms ? (
                    <RoomOrderControls
                      orderId={order.id}
                      roomId={r.id}
                      roomLabel={r.label}
                      canMoveUp={roomIndex > 0}
                      canMoveDown={roomIndex < rooms.length - 1}
                    />
                  ) : undefined}
                />
              ),
            )}
          </section>

          {order.general_notes && (
            <section className="bg-white rounded-lg border border-slate-200 p-4 sm:p-6">
              <h2 className="text-base font-semibold text-slate-900 mb-2">
                General notes
              </h2>
              <p className="text-sm text-slate-700 whitespace-pre-wrap">
                {order.general_notes}
              </p>
            </section>
          )}
        </div>

        <div className="space-y-4 order-2">
          <section className="bg-white rounded-lg border border-slate-200 p-5">
            <h3 className="text-sm font-semibold text-slate-900 mb-3">
              Customer
            </h3>
            <dl className="space-y-2 text-sm">
              <div>
                <dt className="text-xs text-slate-500">Mobile</dt>
                <dd className="text-slate-800">{order.customer_mobile}</dd>
              </div>
              {order.customer_email && (
                <div>
                  <dt className="text-xs text-slate-500">Email</dt>
                  <dd className="text-slate-800">{order.customer_email}</dd>
                </div>
              )}
              {order.property_type && (
                <div>
                  <dt className="text-xs text-slate-500">Property</dt>
                  <dd className="text-slate-800">
                    {order.property_type}
                    {order.development && ` · ${order.development}`}
                  </dd>
                </div>
              )}
              {order.unit_type && (
                <div>
                  <dt className="text-xs text-slate-500">Unit Type</dt>
                  <dd className="text-slate-800">{order.unit_type}</dd>
                </div>
              )}
              {order.move_in_date && (
                <div>
                  <dt className="text-xs text-slate-500">Move-in</dt>
                  <dd className="text-slate-800">
                    {formatDate(order.move_in_date)}
                  </dd>
                </div>
              )}
            </dl>
          </section>

          <section className="bg-white rounded-lg border border-slate-200 p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">
                Customer price &amp; payment
              </h3>
              {session.profile.role === "admin" && (
                <EditPaymentDialog
                  orderId={order.id}
                  defaultQuotedCents={
                    quote?.groupbuySgdCents ?? order.price_quoted_cents
                  }
                />
              )}
            </div>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-500">Agreed customer price</dt>
                <dd className="font-medium text-slate-900">
                  {formatSGD(order.price_quoted_cents)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Deposit paid</dt>
                <dd className="font-medium text-emerald-700">
                  {formatSGD(order.deposit_cents)}
                </dd>
              </div>
              <div className="flex justify-between pt-2 border-t border-slate-100">
                <dt className="text-slate-500">Balance due</dt>
                <dd className="font-semibold text-teal-700">
                  {formatSGD(order.balance_cents)}
                </dd>
              </div>
            </dl>
          </section>

          {quote && (
            <QuoteCard
              quote={quote}
              quotedCents={order.price_quoted_cents}
              orderId={order.id}
              depositCents={order.deposit_cents}
              locked={locked}
              meshAreas={meshAreaBreakdown}
            />
          )}

          <section className="bg-white rounded-lg border border-slate-200 p-5">
            <h3 className="text-sm font-semibold text-slate-900 mb-3">
              Consultation
            </h3>
            <dl className="space-y-2 text-sm">
              {(() => {
                const name =
                  order.consultant_name?.trim() ||
                  (order.consultant_email
                    ? order.consultant_email.split("@")[0]
                    : null);
                if (!name) return null;
                return (
                  <div>
                    <dt className="text-xs text-slate-500">Consultant</dt>
                    <dd className="text-slate-800">{name}</dd>
                  </div>
                );
              })()}
              <div>
                <dt className="text-xs text-slate-500">PO number</dt>
                <dd className="mt-0.5">
                  <OrderReferenceField
                    orderId={order.id}
                    reference={order.order_reference}
                    canEdit={
                      session.profile.role === "ops" ||
                      session.profile.role === "admin"
                    }
                  />
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Created</dt>
                <dd className="text-slate-800">
                  {formatDate(order.created_at)}
                </dd>
              </div>
            </dl>
          </section>
        </div>
      </div>
    </main>
  );
}
