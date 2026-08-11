import Link from "next/link";
import { notFound } from "next/navigation";

import { AdvanceStatusButton } from "@/components/orders/advance-status-button";
import { DeleteOrderDialog } from "@/components/orders/delete-order-dialog";
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
import { STATUS_FLOW, STATUS_LABELS, statusIndex } from "@/lib/status-flow";
import { requireSession } from "@/lib/auth/require-role";
import { formatCurtainOptionLabel } from "@/lib/curtain-types/series";
import { signCurtainTypePhotoUrls } from "@/lib/db/curtain-types";
import { db } from "@/lib/db/kysely";
import { signRoomPhotoUrls } from "@/lib/db/photos";
import { formatSGD } from "@/lib/money";
import { computeOrderQuote } from "@/lib/pricing/order-quote";

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
          .leftJoin(
            "curtain_types as toilet_ct",
            "toilet_ct.id",
            "windows.curtain_type_id",
          )
          .leftJoin("curtain_series as day_cs", "day_cs.id", "day_ct.series_id")
          .leftJoin(
            "curtain_series as night_cs",
            "night_cs.id",
            "night_ct.series_id",
          )
          .leftJoin(
            "curtain_series as toilet_cs",
            "toilet_cs.id",
            "toilet_ct.series_id",
          )
          .leftJoin("pricing_combos as combo", "combo.id", "windows.combo_id")
          .select([
            "windows.id as id",
            "windows.room_id as room_id",
            "windows.position as position",
            "windows.width_cm as width_cm",
            "windows.height_cm as height_cm",
            "windows.install_width_cm as install_width_cm",
            "windows.notes as notes",
            "windows.draw as draw",
            "windows.add_s_fold as add_s_fold",
            "windows.add_slim_tracks as add_slim_tracks",
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
            "toilet_ct.label as curtain_label",
            "toilet_ct.photo_path as curtain_photo_path",
            "toilet_ct.series_index as curtain_index",
            "toilet_ct.page as curtain_page",
            "toilet_cs.name as curtain_series",
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
            "mesh_panels.depth_cm as depth_cm",
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

  const panelsByRoom = new Map<string, MeshPanelSummary[]>();
  for (const p of meshPanels) {
    const list = panelsByRoom.get(p.room_id) ?? [];
    list.push(p);
    panelsByRoom.set(p.room_id, list);
  }

  // Sign every referenced curtain-type hero photo in one batch.
  const curtainPhotoPaths = windows
    .flatMap((w) => [
      w.day_curtain_photo_path,
      w.night_curtain_photo_path,
      w.curtain_photo_path,
    ])
    .filter((p): p is string => !!p);
  const curtainPhotoUrls = await signCurtainTypePhotoUrls(curtainPhotoPaths);
  const urlFor = (path: string | null) =>
    path ? (curtainPhotoUrls.get(path) ?? null) : null;

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
    install_width_cm: w.install_width_cm,
    notes: w.notes,
    draw: w.draw,
    add_s_fold: w.add_s_fold,
    add_slim_tracks: w.add_slim_tracks,
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
    curtain_label: labelOf(
      w.curtain_series,
      w.curtain_index,
      w.curtain_page,
      w.curtain_label,
    ),
    curtain_photo_url: urlFor(w.curtain_photo_path),
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
            session.profile.role === "admin" ||
            order.consultant_id === session.user.id;
          const isAdvancer =
            session.profile.role === "ops" ||
            session.profile.role === "admin";
          const currentIdx = statusIndex(order.current_status);
          const atEnd = currentIdx === STATUS_FLOW.length - 1;
          const nextLabel = atEnd
            ? undefined
            : STATUS_LABELS[STATUS_FLOW[currentIdx + 1]];

          if (!canEdit && !isAdvancer) return null;

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
              <PrintButton />
              {isAdvancer && (
                <AdvanceStatusButton
                  orderId={order.id}
                  atEnd={atEnd}
                  nextLabel={nextLabel}
                />
              )}
              {session.profile.role === "admin" && (
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
            {quote?.isStale && (
              <RequoteBanner
                orderId={order.id}
                lockedCents={order.price_quoted_cents}
                liveCents={quote.discountedSaleSgdCents}
              />
            )}
          </section>

          {quote && <QuoteCard quote={quote} />}

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
