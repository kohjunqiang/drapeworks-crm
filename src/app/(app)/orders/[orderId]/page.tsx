import Link from "next/link";
import { notFound } from "next/navigation";

import { AdvanceStatusButton } from "@/components/orders/advance-status-button";
import { DeleteOrderDialog } from "@/components/orders/delete-order-dialog";
import { DeliveryNumbersCard } from "@/components/orders/delivery-numbers-card";
import { OrderReferenceField } from "@/components/orders/order-reference-field";
import { PrintButton } from "@/components/orders/print-button";
import { QuoteCard } from "@/components/orders/quote-card";
import { RequoteBanner } from "@/components/orders/requote-banner";
import { RoomSummaryCard } from "@/components/orders/room-summary-card";
import {
  MeshRoomSummaryCard,
  type MeshPanelSummary,
} from "@/components/orders/mesh-room-summary-card";
import type { PhotoTile } from "@/components/orders/photo-strip";
import { StatusBadge } from "@/components/orders/status-badge";
import { StatusTimeline } from "@/components/orders/status-timeline";
import {
  STATUS_FLOW,
  STATUS_LABELS,
  isLocked,
  statusIndex,
} from "@/lib/status-flow";
import { requireSession } from "@/lib/auth/require-role";
import { formatCurtainOptionLabel } from "@/lib/curtain-types/series";
import { signCurtainTypePhotoUrls } from "@/lib/db/curtain-types";
import { db } from "@/lib/db/kysely";
import {
  loadActiveMeshSystemBands,
  loadActiveMeshSystemSpecs,
} from "@/lib/db/mesh-catalogue";
import {
  formatMmAsCm,
  resolveMeshDrop,
  resolveMeshSystem,
  resolveMeshTrack,
} from "@/lib/orders/mesh-system";
import { signRoomPhotoUrls } from "@/lib/db/photos";
import { formatSGD } from "@/lib/money";
import { panelBillableArea } from "@/lib/pricing/mesh-calculator";
import {
  computeOrderQuote,
  loadMeshPriceBook,
} from "@/lib/pricing/order-quote";

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
      "orders.property_type as property_type",
      "orders.development as development",
      "orders.unit_type as unit_type",
      "orders.move_in_date as move_in_date",
      "orders.price_quoted_cents as price_quoted_cents",
      "orders.deposit_cents as deposit_cents",
      "orders.balance_cents as balance_cents",
      "orders.general_notes as general_notes",
      "orders.goods_overseas_tracking_number as goods_overseas_tracking_number",
      "orders.goods_local_delivery_number as goods_local_delivery_number",
      "orders.track_overseas_tracking_number as track_overseas_tracking_number",
      "orders.track_local_delivery_number as track_local_delivery_number",
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

  const rooms = await db
    .selectFrom("rooms")
    .select(["id", "type", "label", "position"])
    .where("order_id", "=", order.id)
    .orderBy("position", "asc")
    .execute();

  const roomIds = rooms.map((r) => r.id);

  const isMesh = order.product_line === "mesh";

  const windows =
    roomIds.length === 0 || isMesh
      ? []
      : await db
          .selectFrom("windows")
          .leftJoin(
            "curtain_types as day_ct",
            "day_ct.id",
            "windows.day_curtain_type_id",
          )
          .leftJoin(
            "curtain_types as night_ct",
            "night_ct.id",
            "windows.night_curtain_type_id",
          )
          .leftJoin("curtain_series as day_cs", "day_cs.id", "day_ct.series_id")
          .leftJoin(
            "curtain_series as night_cs",
            "night_cs.id",
            "night_ct.series_id",
          )
          .leftJoin(
            "curtain_types as blind_ct",
            "blind_ct.id",
            "windows.blind_type_id",
          )
          .leftJoin(
            "curtain_series as blind_cs",
            "blind_cs.id",
            "blind_ct.series_id",
          )
          .leftJoin("pricing_combos as combo", "combo.id", "windows.combo_id")
          .select([
            "windows.id as id",
            "windows.room_id as room_id",
            "windows.position as position",
            "windows.width_cm as width_cm",
            "windows.height_cm as height_cm",
            "windows.notes as notes",
            "windows.draw as draw",
            "combo.name as combo_label",
            "day_ct.label as day_curtain_label",
            "day_ct.photo_path as day_curtain_photo_path",
            "day_ct.series_index as day_curtain_index",
            "day_ct.page as day_curtain_page",
            "day_cs.name as day_curtain_series",
            "night_ct.label as night_curtain_label",
            "night_ct.photo_path as night_curtain_photo_path",
            "night_ct.series_index as night_curtain_index",
            "night_ct.page as night_curtain_page",
            "night_cs.name as night_curtain_series",
            "windows.blind_type_id as blind_type_id",
            "blind_ct.label as blind_label",
            "blind_ct.photo_path as blind_photo_path",
            "blind_ct.series_index as blind_index",
            "blind_ct.page as blind_page",
            "blind_cs.name as blind_series",
          ])
          .where("windows.room_id", "in", roomIds)
          .orderBy("windows.position", "asc")
          .execute();

  // Mesh panels for a mesh order. Joined to the catalogue by id regardless of
  // is_active, so an archived category or colour still renders on an existing
  // order rather than showing a blank.
  const meshPanels =
    roomIds.length === 0 || !isMesh
      ? []
      : await db
          .selectFrom("mesh_panels")
          .leftJoin(
            "mesh_categories as mc",
            "mc.id",
            "mesh_panels.category_id",
          )
          .leftJoin("mesh_colours as mcol", "mcol.id", "mesh_panels.colour_id")
          .select([
            "mesh_panels.room_id as room_id",
            "mesh_panels.position as position",
            "mesh_panels.width_cm as width_cm",
            "mesh_panels.height_cm as height_cm",
            "mesh_panels.has_window as has_window",
            "mesh_panels.has_inset_horizontal as has_inset_horizontal",
            "mesh_panels.has_inset_vertical as has_inset_vertical",
            "mesh_panels.category_id as category_id",
            "mesh_panels.colour_id as colour_id",
            "mesh_panels.draw as draw",
            "mesh_panels.split_left_cm as split_left_cm",
            "mesh_panels.split_right_cm as split_right_cm",
            "mesh_panels.notes as notes",
            "mc.name as category_name",
            "mcol.name as colour_name",
          ])
          .where("mesh_panels.room_id", "in", roomIds)
          .orderBy("mesh_panels.position", "asc")
          .execute();

  // The track system is derived, never stored (§5.9), so it is resolved here
  // for the factory sheet rather than read off the row.
  const [systemBands, systemSpecs, meshBook] = isMesh
    ? await Promise.all([
        loadActiveMeshSystemBands(),
        loadActiveMeshSystemSpecs(),
        loadMeshPriceBook(),
      ])
    : [[], [], null];

  const panelsByRoom = new Map<string, MeshPanelSummary[]>();
  for (const p of meshPanels) {
    const list = panelsByRoom.get(p.room_id) ?? [];
    const key = {
      widthCm: p.width_cm,
      heightCm: p.height_cm,
      draw: p.draw ?? undefined,
      hasInsetHorizontal: p.has_inset_horizontal,
      hasInsetVertical: p.has_inset_vertical,
    };
    const resolved = resolveMeshSystem(key, systemBands);
    const track = resolveMeshTrack(key, systemBands, systemSpecs);
    const drop = resolveMeshDrop(key, systemBands, systemSpecs);
    // Only set when a minimum actually floors the panel, so the column shows
    // the uplift rather than repeating the measured area.
    const billable = meshBook
      ? panelBillableArea(
          {
            categoryId: p.category_id,
            colourId: p.colour_id,
            widthCm: p.width_cm,
            heightCm: p.height_cm,
            draw: p.draw ?? null,
          },
          meshBook,
        )
      : null;
    list.push({
      ...p,
      system: resolved.status === "resolved" ? resolved.system : null,
      trackCm:
        track.status === "resolved" ? formatMmAsCm(track.trackMm) : null,
      dropCm: drop.status === "resolved" ? formatMmAsCm(drop.dropMm) : null,
      billedSqm:
        billable && billable.billableCm2 > billable.actualCm2
          ? (billable.billableCm2 / 10_000).toFixed(2)
          : null,
    });
    panelsByRoom.set(p.room_id, list);
  }

  // Sign every referenced curtain-type hero photo in one batch.
  const curtainPhotoPaths = windows
    .flatMap((w) => [
      w.day_curtain_photo_path,
      w.night_curtain_photo_path,
    ])
    .filter((p): p is string => !!p);
  const curtainPhotoUrls = await signCurtainTypePhotoUrls(curtainPhotoPaths);
  const urlFor = (path: string | null) =>
    path ? (curtainPhotoUrls.get(path) ?? null) : null;

  // A window's add-ons, by name, for the summary card. Read from the join as
  // written — the same rows the quote priced.
  const addonLabelsByWindow = new Map<string, string[]>();
  for (const r of roomIds.length === 0 || isMesh
    ? []
    : await db
        .selectFrom("window_addons")
        .innerJoin("windows", "windows.id", "window_addons.window_id")
        .innerJoin(
          "pricing_addons",
          "pricing_addons.id",
          "window_addons.addon_id",
        )
        .select([
          "window_addons.window_id as window_id",
          "pricing_addons.label as label",
        ])
        .where("windows.room_id", "in", roomIds)
        .orderBy("pricing_addons.label", "asc")
        .execute()) {
    addonLabelsByWindow.set(r.window_id, [
      ...(addonLabelsByWindow.get(r.window_id) ?? []),
      r.label,
    ]);
  }

  // Build the "Series #index · Page — Label" display string per curtain, or
  // null when the window has no curtain type selected.
  const labelOf = (
    series: string | null,
    index: number | null,
    page: string | null,
    label: string | null,
  ) =>
    label
      ? formatCurtainOptionLabel({ series, index, page, label })
      : null;

  const windowSummaries = windows.map((w) => ({
    position: w.position,
    width_cm: w.width_cm,
    height_cm: w.height_cm,
    notes: w.notes,
    draw: w.draw,
    addon_labels: addonLabelsByWindow.get(w.id) ?? [],
    combo_label: w.combo_label,
    room_id: w.room_id,
    day_curtain_label: labelOf(
      w.day_curtain_series,
      w.day_curtain_index,
      w.day_curtain_page,
      w.day_curtain_label,
    ),
    day_curtain_photo_url: urlFor(w.day_curtain_photo_path),
    night_curtain_label: labelOf(
      w.night_curtain_series,
      w.night_curtain_index,
      w.night_curtain_page,
      w.night_curtain_label,
    ),
    night_curtain_photo_url: urlFor(w.night_curtain_photo_path),
    is_blind: w.blind_type_id != null,
    blind_label: labelOf(
      w.blind_series,
      w.blind_index,
      w.blind_page,
      w.blind_label,
    ),
    blind_photo_url: urlFor(w.blind_photo_path),
  }));

  const windowsByRoom = new Map<string, typeof windowSummaries>();
  for (const w of windowSummaries) {
    const list = windowsByRoom.get(w.room_id) ?? [];
    list.push(w);
    windowsByRoom.set(w.room_id, list);
  }

  const events = await db
    .selectFrom("order_status_events")
    .select(["id", "status", "note", "created_at"])
    .where("order_id", "=", order.id)
    .orderBy("created_at", "desc")
    .execute();

  // Once the order is with the vendor the consultation is frozen. The date
  // comes from the EARLIEST sent_to_vendor event: an admin amendment writes a
  // second event at the same status, and "locked on" means when it happened,
  // not when it was last touched.
  const locked = isLocked(order.current_status);
  const lockedAt = locked
    ? (events
        .filter((e) => e.status === "sent_to_vendor")
        .reduce<Date | null>((earliest, e) => {
          const at = new Date(e.created_at);
          return earliest && earliest <= at ? earliest : at;
        }, null) ?? null)
    : null;

  const photos =
    roomIds.length === 0
      ? []
      : await db
          .selectFrom("room_photos")
          .select([
            "id",
            "room_id",
            "storage_path",
            "original_name",
            "position",
            "created_at",
          ])
          .where("room_id", "in", roomIds)
          .orderBy("position", "asc")
          .orderBy("created_at", "asc")
          .execute();

  const signed = await signRoomPhotoUrls(photos.map((p) => p.storage_path));

  const photosByRoom = new Map<string, PhotoTile[]>();
  for (const p of photos) {
    const url = signed.get(p.storage_path);
    if (!url) continue;
    const list = photosByRoom.get(p.room_id) ?? [];
    list.push({
      id: p.id,
      signedUrl: url,
      originalName: p.original_name,
    });
    photosByRoom.set(p.room_id, list);
  }

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
            Order {order.display_id}
          </div>
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
              ? "Record deposit received"
              : undefined;
          // Recording the deposit exists to unblock the measurements review, so
          // go straight there rather than returning to this page and asking for
          // a second click to do the thing the first click was for.
          const advanceTo =
            order.current_status === "order_recorded"
              ? `/orders/${order.id}/manufacture`
              : undefined;

          // A locked order still renders the row, so a consultant who can no
          // longer edit is told why rather than shown an empty header.
          if (!canEdit && !isAdvancer && !locked) return null;

          return (
            <div className="flex flex-wrap items-center gap-2">
              {/* Stands in for Edit and Delete rather than sitting beside a
                  disabled pair: a greyed-out button invites a click and then
                  explains nothing. */}
              {locked && (
                <span
                  title={`This order is at "${STATUS_LABELS[order.current_status]}". The consultation cannot be edited once it has gone to the vendor.`}
                  className="px-2.5 py-1.5 text-xs sm:text-sm rounded border border-slate-300 bg-slate-100 text-slate-600"
                >
                  🔒 Locked — sent to the vendor
                  {lockedAt && ` on ${formatDate(lockedAt)}`}
                </span>
              )}
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
                    className="px-3 py-1.5 text-xs sm:text-sm border border-teal-600 text-teal-700 rounded hover:bg-teal-50 font-medium"
                  >
                    Review manufacturing measurements
                  </Link>
                )}
              {isAdvancer && isLocked(order.current_status) && (
                <Link
                  href={`/orders/${order.id}/manufacture`}
                  className="px-3 py-1.5 text-xs sm:text-sm border border-slate-300 rounded hover:bg-white"
                >
                  View vendor POs
                </Link>
              )}
              <PrintButton />
              {isAdvancer && order.current_status !== "deposit_received" && order.current_status !== "po_ready" && (
                <AdvanceStatusButton
                  orderId={order.id}
                  atEnd={atEnd}
                  nextLabel={nextLabel}
                  ctaLabel={ctaLabel}
                  advanceTo={advanceTo}
                />
              )}
              {session.profile.role === "admin" && !locked && (
                <DeleteOrderDialog
                  orderId={order.id}
                  displayId={order.display_id}
                  customerName={order.customer_name}
                />
              )}
            </div>
          );
        })()}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-6">
        <div className="lg:col-span-2 space-y-4 order-2 lg:order-1">
          {statusIndex(order.current_status) >= statusIndex("sent_to_vendor") && (
            <DeliveryNumbersCard orderId={order.id} canEdit={session.profile.role === "ops" || session.profile.role === "admin"}
              initial={{
                goodsOverseas: order.goods_overseas_tracking_number ?? "",
                goodsLocal: order.goods_local_delivery_number ?? "",
                trackOverseas: order.track_overseas_tracking_number ?? "",
                trackLocal: order.track_local_delivery_number ?? "",
              }} />
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

          <section className="bg-white rounded-lg border border-slate-200 p-4 sm:p-6">
            <h2 className="text-base font-semibold text-slate-900 mb-4">
              Rooms &amp; measurements{" "}
              <span className="text-xs font-normal text-slate-500">(cm)</span>
            </h2>
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

        <div className="space-y-4 order-1 lg:order-2">
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
            <h3 className="text-sm font-semibold text-slate-900 mb-3">
              Payment
            </h3>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-500">Quoted</dt>
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
            {/* The drift is still worth stating on a locked order — someone
                may need to explain the number to the customer — but re-quoting
                is an edit, and the goods are already being cut. */}
            {quote?.isStale &&
              (locked ? (
                <p className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                  Pricing has since changed (now calculates to{" "}
                  <span className="font-semibold">
                    {formatSGD(quote.discountedSaleSgdCents)}
                  </span>
                  ), but this order is locked at{" "}
                  <span className="font-semibold">
                    {formatSGD(order.price_quoted_cents)}
                  </span>
                  .
                </p>
              ) : (
                <RequoteBanner
                  orderId={order.id}
                  lockedCents={order.price_quoted_cents}
                  liveCents={quote.discountedSaleSgdCents}
                />
              ))}
          </section>

          {quote && (
            <QuoteCard
              quote={quote}
              quotedCents={order.price_quoted_cents}
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
                <dt className="text-xs text-slate-500">Order reference</dt>
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
