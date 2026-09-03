import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import {
  AmendDialog,
  type AmendLine,
} from "@/components/manufacture/amend-dialog";
import {
  FrozenMeasurements,
  type FrozenLine,
  type FrozenRoom,
} from "@/components/manufacture/frozen-measurements";
import {
  PoGenerationButton,
  PoList,
  type PoListItem,
} from "@/components/manufacture/po-list";
import { ShipsToSelect } from "@/components/manufacture/ships-to-select";
import { CustomerReferenceInput } from "@/components/manufacture/customer-reference-input";
import { PoNumberInput } from "@/components/manufacture/po-number-input";
import { SendToVendorButton } from "@/components/manufacture/send-to-vendor-button";
import { customerReference } from "@/lib/po/customer-reference";
import { ensurePoNumber } from "@/lib/po/assign-number";
import { TrackOrderCard } from "@/components/manufacture/track-order-card";
import {
  Reconciliation,
  type ReconRoom,
} from "@/components/manufacture/reconciliation";
import type { ReconLine } from "@/components/manufacture/reconciliation-row";
import { StatusBadge } from "@/components/orders/status-badge";
import { requireSession } from "@/lib/auth/require-role";
import { db } from "@/lib/db/kysely";
import { loadDeliveryVendors, loadOrderPos } from "@/lib/db/procurement";
import { buildPos } from "@/lib/po/build";
import { loadPoInput } from "@/lib/po/load";
import {
  overlapTrackOrderText,
  trackOrderText,
} from "@/lib/po/track-order";
import { loadTrackOrder } from "@/lib/po/track-order-load";
import { applyAllowance, resolveAllowance } from "@/lib/manufacture/allowance";
import type { AllowanceLine } from "@/lib/manufacture/allowance";
import {
  loadAllowanceBook,
  loadManufactureLines,
  type ManufactureLine,
} from "@/lib/manufacture/load";
import type { FreightMode, FulfilmentStatus, ProductLine } from "@/lib/db/schema";
import { isLocked, statusIndex } from "@/lib/status-flow";

export const dynamic = "force-dynamic";

export const metadata = { title: "Manufacturing measurements — Drapeworks CRM" };

const SG_DATE = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

// Documents are stamped to the minute: two regenerations on one afternoon have
// to be told apart, and "which one did we send" is the question this screen
// exists to answer. Singapore time explicitly — the business's clock, not the
// server's, and not the reader's browser either, since the string is formatted
// here and shipped as text.
const SG_DATE_TIME = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Asia/Singapore",
});

const LINE_LABELS: Record<AllowanceLine, string> = {
  curtain: "Curtains",
  blind: "Blinds",
  mesh: "Mesh",
};

// Positions are stored 0-based (the consultation form indexes them), so the
// display is +1 — nobody calls the first window on the wall "window 0".
function labelOf(line: ManufactureLine): string {
  const noun = line.kind === "window" ? "Window" : "Panel";
  return `${noun} ${line.position + 1}`;
}

// Lines arrive ordered by room position then item position, so rooms group by
// walking the list rather than sorting again.
function groupByRoom<T>(
  lines: ManufactureLine[],
  make: (line: ManufactureLine) => T,
): { roomId: string; label: string; lines: T[] }[] {
  const rooms: { roomId: string; label: string; lines: T[] }[] = [];
  for (const line of lines) {
    const key = `${line.roomPosition}::${line.roomLabel}`;
    let room = rooms[rooms.length - 1];
    if (!room || room.roomId !== key) {
      // Room labels are what the consultant wrote on site — verbatim.
      room = { roomId: key, label: line.roomLabel, lines: [] };
      rooms.push(room);
    }
    room.lines.push(make(line));
  }
  return rooms;
}

type Params = { orderId: string };

export default async function ManufacturePage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { orderId } = await params;
  const session = await requireSession();

  // Ops and admin only. A redirect rather than requireRole's 404: a consultant
  // following a link from the order they wrote should land back on it, not on
  // a dead end that reads like the order is gone.
  if (session.profile.role !== "ops" && session.profile.role !== "admin") {
    redirect(`/orders/${orderId}`);
  }

  const order = await db
    .selectFrom("orders")
    .innerJoin("customers", "customers.id", "orders.customer_id")
    .select([
      "orders.id as id",
      "orders.display_id as display_id",
      "orders.order_reference as order_reference",
      "orders.po_customer_reference as po_customer_reference",
      "orders.development as development",
      "orders.site_address as site_address",
      "orders.unit_type as unit_type",
      "orders.current_status as current_status",
      "orders.freight_mode as freight_mode",
      "orders.delivery_vendor_id as delivery_vendor_id",
      "orders.product_line as product_line",
      "customers.name as customer_name",
    ])
    .where("orders.id", "=", orderId)
    .executeTakeFirst();
  if (!order) notFound();

  // There is nothing to review until the deposit is in — the measurements are
  // derived between taking the money and placing the vendor order.
  if (statusIndex(order.current_status) < statusIndex("deposit_received")) {
    redirect(`/orders/${order.id}`);
  }

  // A number shown here must already be the number generation will read. Do
  // this on the server so a stalled or disabled browser cannot display a
  // suggestion while the database still says the order has no PO number.
  order.order_reference = await ensurePoNumber(order.id);

  const locked = isLocked(order.current_status);
  const [lines, deliveryAddresses] = await Promise.all([
    loadManufactureLines(order.id),
    loadDeliveryVendors(),
  ]);

  return (
    <Shell order={order}>
      {locked ? (
        <FrozenView
          orderId={order.id}
          status={order.current_status}
          lines={lines}
          canAmend={session.profile.role === "admin"}
          order={order}
          deliveryAddresses={deliveryAddresses}
        />
      ) : (
        <>
          <PoDetailsSection order={order} deliveryAddresses={deliveryAddresses} />
          <EditableView
            order={order}
            lines={lines}
            isAdmin={session.profile.role === "admin"}
          />
        </>
      )}
    </Shell>
  );
}

type DeliveryAddress = Awaited<ReturnType<typeof loadDeliveryVendors>>[number];

function PoDetailsSection({
  order,
  deliveryAddresses,
  measurements,
  collapseMeasurements = false,
}: {
  order: OrderHeader;
  deliveryAddresses: DeliveryAddress[];
  measurements?: React.ReactNode;
  collapseMeasurements?: boolean;
}) {
  return (
    <section className="mb-4 rounded-lg border border-slate-200 bg-white overflow-hidden">
      <div className="border-b border-slate-200 bg-slate-50 px-4 py-2">
        <h2 className="text-sm font-semibold text-slate-800">PO details</h2>
        <p className="mt-0.5 text-xs text-slate-500">
          These details are printed on every vendor PDF for this order.
        </p>
      </div>
      <div className="grid gap-4 p-4 md:grid-cols-2">
        <PoNumberInput
          key={`${order.id}:${order.order_reference}`}
          orderId={order.id}
          initialValue={order.order_reference ?? ""}
          embedded
        />
        <ShipsToSelect
          orderId={order.id}
          addresses={deliveryAddresses.map((address) => ({
            id: address.id,
            label: address.label,
            isDefault: address.is_default,
            isActive: address.is_active,
          }))}
          selectedId={order.delivery_vendor_id}
          isAir={order.freight_mode === "air"}
          embedded
        />
        <div className="md:col-span-2 border-t border-slate-100 pt-4">
          <CustomerReferenceInput
            key={`${order.id}:${order.po_customer_reference ?? ""}`}
            orderId={order.id}
            initialValue={customerReference(order) ?? ""}
            embedded
          />
        </div>
      </div>
      {measurements && (collapseMeasurements ? (
        <details className="group border-t border-slate-200">
          <summary className="cursor-pointer list-none bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-100">
            <span className="inline-flex items-center gap-2">
              <span className="transition-transform group-open:rotate-90">›</span>
              View finalized installation measurements
            </span>
          </summary>
          <div className="border-t border-slate-200 p-4">{measurements}</div>
        </details>
      ) : (
        <div className="border-t border-slate-200 p-4">{measurements}</div>
      ))}
    </section>
  );
}

function VendorHandoffCard({
  orderId,
  status,
  productLine,
  hasCurrentPos,
  hasDocuments,
  problems,
}: {
  orderId: string;
  status: FulfilmentStatus;
  productLine: ProductLine;
  hasCurrentPos: boolean;
  hasDocuments: boolean;
  problems: string[];
}) {
  const handoffConfirmed = statusIndex(status) >= statusIndex("sent_to_vendor");
  const vendorFilesReady = productLine === "mesh" || hasCurrentPos;
  const steps = [
    { label: "Measurements finalized", done: true },
    { label: productLine === "mesh" ? "Manual order reviewed" : "Vendor files ready", done: vendorFilesReady },
    { label: "Handoff confirmed", done: handoffConfirmed },
  ];

  return (
    <section className="mb-4 overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 sm:px-5">
        <h2 className="text-base font-semibold text-slate-900">Vendor handoff</h2>
        <p className="mt-0.5 text-xs text-slate-500">
          {handoffConfirmed
            ? "Handoff is confirmed. The files recorded for the vendor are available below."
            : vendorFilesReady
              ? "Files are ready. Review or share them below, then confirm the manual handoff."
              : "Prepare the vendor files, review them, then confirm they were sent."}
        </p>
      </div>
      <ol className="grid gap-px bg-slate-200 sm:grid-cols-3">
        {steps.map((step, index) => {
          const current = !step.done && steps.slice(0, index).every((item) => item.done);
          return (
            <li key={step.label} className="flex items-center gap-3 bg-white px-4 py-3">
              <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                step.done
                  ? "bg-emerald-100 text-emerald-700"
                  : current
                    ? "bg-orange-100 text-orange-700 ring-2 ring-orange-200"
                    : "bg-slate-100 text-slate-500"
              }`}>
                {step.done ? "✓" : index + 1}
              </span>
              <span className={`text-sm ${step.done ? "font-medium text-slate-800" : "text-slate-600"}`}>
                {step.label}
              </span>
            </li>
          );
        })}
      </ol>
      <div className="flex flex-col gap-3 border-t border-slate-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <p className="text-xs text-slate-500">
          {handoffConfirmed
            ? "Creating a revised PO does not send it; the new revision must be handed off again."
            : problems.length > 0
              ? "Resolve the PO issues listed below before continuing."
              : vendorFilesReady
                ? "Generating and sending are separate: confirm only after every current file is sent."
                : "Generation creates the files only—it does not contact the vendor."}
        </p>
        <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
          {handoffConfirmed && (
            <span className="rounded bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700">
              ✓ Sent to vendor
            </span>
          )}
          {productLine !== "mesh" && vendorFilesReady && (
            <PoGenerationButton
              orderId={orderId}
              hasDocuments={hasDocuments}
              variant="secondary"
              label={handoffConfirmed ? "Create revised POs" : "Regenerate POs"}
            />
          )}
          {status === "po_ready" && !vendorFilesReady && problems.length === 0 && (
            <PoGenerationButton orderId={orderId} hasDocuments={hasDocuments} />
          )}
          {status === "po_ready" && vendorFilesReady && (
            <SendToVendorButton orderId={orderId} />
          )}
        </div>
      </div>
    </section>
  );
}

type OrderHeader = {
  id: string;
  display_id: string;
  order_reference: string | null;
  po_customer_reference: string | null;
  development: string | null;
  site_address: string | null;
  unit_type: string | null;
  current_status: FulfilmentStatus;
  freight_mode: FreightMode;
  delivery_vendor_id: string | null;
  customer_name: string;
  product_line: ProductLine;
};

function Shell({
  order,
  children,
}: {
  order: OrderHeader;
  children: React.ReactNode;
}) {
  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <div className="text-xs text-slate-500 mb-3">
        <Link href="/orders" className="hover:text-slate-700">
          Orders
        </Link>
        <span className="mx-1">/</span>
        <Link href={`/orders/${order.id}`} className="hover:text-slate-700">
          {order.display_id}
        </Link>
        <span className="mx-1">/</span>
        <span className="text-slate-700">Manufacturing measurements</span>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
              Manufacturing measurements
            </h1>
            <StatusBadge status={order.current_status} />
          </div>
          <p className="text-sm text-slate-500 mt-1 break-words">
            {order.display_id} — {order.customer_name}
            {order.order_reference && ` · PO ${order.order_reference}`}
          </p>
        </div>
        <Link
          href={`/orders/${order.id}`}
          className="px-3 py-1.5 text-sm border border-slate-300 rounded hover:bg-white whitespace-nowrap self-start"
        >
          Back to order
        </Link>
      </div>

      {children}
    </main>
  );
}

// ── before confirmation ────────────────────────────────────────────────────
async function EditableView({
  order,
  lines,
  isAdmin,
}: {
  order: OrderHeader;
  lines: ManufactureLine[];
  /** Ops is the primary reader of this screen but can open neither remedy:
   *  /admin/product/allowances is admin-only, and the edit route 404s for a
   *  non-owner. Offering them a link that dead-ends is worse than telling them
   *  who to ask, so the remedy is named rather than linked for ops. */
  isAdmin: boolean;
}) {
  const book = await loadAllowanceBook();

  // Everything that makes this order unconfirmable, gathered before the grid
  // is built. The confirm action refuses these too; showing them here instead
  // of a grid of half-numbers means nobody types an override against a line
  // that could never have been sent anyway.
  const blockers: { message: string; href?: string; hrefLabel?: string }[] = [];

  if (lines.length === 0) {
    blockers.push({ message: "This order has nothing to manufacture." });
  }

  const unconfigured = [
    ...new Set(
      lines.filter((l) => !resolveAllowance(book, l.line)).map((l) => l.line),
    ),
  ];
  for (const line of unconfigured) {
    blockers.push({
      message: isAdmin
        ? `${LINE_LABELS[line]} have no manufacturing allowance configured, so there is no way to work out what to build.`
        : `${LINE_LABELS[line]} have no manufacturing allowance configured, so there is no way to work out what to build. Ask an admin to set it under Product → Allowances.`,
      href: isAdmin ? "/admin/product/allowances" : undefined,
      hrefLabel: isAdmin ? "Set the allowance" : undefined,
    });
  }

  // Kept lines in order, plus their computed candidates. The two are held
  // apart so grouping can walk the ManufactureLine list (which carries the
  // room) while the client component receives plain numbers only.
  const kept: ManufactureLine[] = [];
  const candidates = new Map<string, ReconLine>();

  for (const line of lines) {
    const allowance = resolveAllowance(book, line.line);
    if (!allowance) continue;
    const applied = applyAllowance(
      { widthCm: line.widthCm, heightCm: line.heightCm },
      allowance,
    );
    if (!applied) {
      blockers.push({
        message: isAdmin
          ? `${line.roomLabel} — ${labelOf(line)} has no measured width and height to work from.`
          : `${line.roomLabel} — ${labelOf(line)} has no measured width and height to work from. Ask the consultant or an admin to add them.`,
        href: isAdmin ? `/orders/${order.id}/edit` : undefined,
        hrefLabel: isAdmin ? "Fix the measurement" : undefined,
      });
      continue;
    }
    kept.push(line);
    candidates.set(line.lineId, {
      lineId: line.lineId,
      kind: line.kind,
      label: labelOf(line),
      description: line.description,
      sourceWidthCm: applied.sourceWidthCm,
      sourceHeightCm: applied.sourceHeightCm,
      mfgWidthCm: applied.mfgWidthCm,
      mfgHeightCm: applied.mfgHeightCm,
      splitLeftCm: line.splitLeftCm,
      splitRightCm: line.splitRightCm,
    });
  }

  if (blockers.length > 0) {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 sm:p-5">
        <h2 className="text-base font-semibold text-amber-900">
          This order cannot be sent to a vendor yet
        </h2>
        <ul className="mt-3 space-y-2 text-sm text-amber-900">
          {blockers.map((b) => (
            <li key={b.message} className="flex flex-wrap items-baseline gap-2">
              <span>⚠ {b.message}</span>
              {b.href && (
                <Link
                  href={b.href}
                  className="font-medium underline underline-offset-2 hover:text-amber-950"
                >
                  {b.hrefLabel}
                </Link>
              )}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const rooms: ReconRoom[] = groupByRoom(kept, (line) =>
    candidates.get(line.lineId)!,
  );

  return (
    <>
      <p className="mb-4 text-sm text-slate-600 max-w-3xl">
        The left column is what was measured on site. The right column is what
        the vendor will be told to build — the opening plus the manufacturing
        allowance. Every difference is flagged. Change anything that needs
        changing, with a reason, then confirm.
      </p>
      <Reconciliation orderId={order.id} rooms={rooms} />
    </>
  );
}

// ── after confirmation ─────────────────────────────────────────────────────
async function FrozenView({
  orderId,
  status,
  lines,
  canAmend,
  order,
  deliveryAddresses,
}: {
  orderId: string;
  status: FulfilmentStatus;
  lines: ManufactureLine[];
  canAmend: boolean;
  order: OrderHeader;
  deliveryAddresses: DeliveryAddress[];
}) {
  const stored = await db
    .selectFrom("manufacture_measurements")
    .select([
      "window_id",
      "mesh_panel_id",
      "source_width_cm",
      "source_height_cm",
      "width_delta_cm",
      "height_delta_cm",
      "mfg_width_cm",
      "mfg_height_cm",
      "mfg_split_left_cm",
      "mfg_split_right_cm",
      "is_overridden",
      "override_reason",
      "confirmed_at",
    ])
    .where("order_id", "=", orderId)
    .execute();

  const byLine = new Map(
    stored.map((r) => [(r.window_id ?? r.mesh_panel_id) as string, r]),
  );

  // Labels and ordering come from the line items; every NUMBER comes from the
  // stored row. A line with no stored row is dropped rather than recomputed —
  // showing a candidate here would read as "this is what the vendor has".
  const rooms: FrozenRoom[] = groupByRoom<FrozenLine | null>(lines, (line) => {
    const row = byLine.get(line.lineId);
    if (!row) return null;
    return {
      lineId: line.lineId,
      label: labelOf(line),
      description: line.description,
      sourceWidthCm: row.source_width_cm,
      sourceHeightCm: row.source_height_cm,
      widthDeltaCm: row.width_delta_cm,
      heightDeltaCm: row.height_delta_cm,
      mfgWidthCm: row.mfg_width_cm,
      mfgHeightCm: row.mfg_height_cm,
      sourceSplitLeftCm: line.splitLeftCm ?? null,
      sourceSplitRightCm: line.splitRightCm ?? null,
      mfgSplitLeftCm: row.mfg_split_left_cm,
      mfgSplitRightCm: row.mfg_split_right_cm,
      isOverridden: row.is_overridden,
      overrideReason: row.override_reason,
    };
  })
    .map((room) => ({
      ...room,
      lines: room.lines.filter((l): l is FrozenLine => l !== null),
    }))
    .filter((room) => room.lines.length > 0);

  // The documents, and — from the same loader generation itself uses — why
  // there are none. Asking both every time is what lets the screen say "these
  // are stale and here is what is blocking a fresh one", which is the state an
  // amendment leaves behind when generation refuses.
  const [poRows, poLoad, trackOrder] = await Promise.all([
    loadOrderPos(orderId),
    loadPoInput(orderId, new Date()),
    loadTrackOrder(orderId),
  ]);
  const poProblems = order.product_line === "mesh"
    ? []
    : poLoad.input
      ? buildPos(poLoad.input).problems
      : poLoad.problems;
  const pos: PoListItem[] = poRows.map((row) => ({
    id: row.id,
    category: row.category,
    vendorName: row.vendor_name,
    vendorNameCn: row.vendor_name_cn,
    poNumber: row.po_number,
    generatedLabel: SG_DATE_TIME.format(new Date(row.generated_at)),
    supersededLabel: row.superseded_at
      ? SG_DATE_TIME.format(new Date(row.superseded_at))
      : null,
    notes: row.notes,
  }));
  const hasCurrentPos = pos.some((po) => po.supersededLabel === null);

  // Built on the server so the page ships the finished text: what is copied is
  // exactly what is on screen, with no second assembly in the browser.
  const standardTrackOrder = trackOrderText(
    trackOrder.lines.filter((line) => line.shipmentKind === "standard_tracks"),
    trackOrder.noteCn,
  );
  const sFoldTrackOrder = trackOrderText(
    trackOrder.lines.filter((line) => line.shipmentKind === "s_fold_tracks"),
    trackOrder.noteCn,
  );
  const overlapTrackOrder = overlapTrackOrderText(
    trackOrder.lines,
    trackOrder.noteCn,
  );

  const confirmedAt = stored.reduce<Date | null>((earliest, r) => {
    const at = new Date(r.confirmed_at);
    return earliest && earliest <= at ? earliest : at;
  }, null);

  // Flattened for the amend dialog, which edits across rooms in one pass and
  // so needs the room in each label to keep two "Window 1"s apart.
  const amendLines: AmendLine[] = rooms.flatMap((room) =>
    room.lines.map((l) => ({
      lineId: l.lineId,
      label: `${room.label} — ${l.label}`,
      sourceWidthCm: l.sourceWidthCm,
      sourceHeightCm: l.sourceHeightCm,
      mfgWidthCm: l.mfgWidthCm,
      mfgHeightCm: l.mfgHeightCm,
    })),
  );

  return (
    <>
      <VendorHandoffCard
        orderId={orderId}
        status={status}
        productLine={order.product_line}
        hasCurrentPos={hasCurrentPos}
        hasDocuments={pos.length > 0}
        problems={poProblems}
      />
      <PoDetailsSection
        order={order}
        deliveryAddresses={deliveryAddresses}
        collapseMeasurements
        measurements={(
          <>
            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-800">
                  Installation measurements
                </h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  Frozen{confirmedAt && ` on ${SG_DATE.format(confirmedAt)}`}.
                  {status === "po_ready" ? " Review before generating." : " These are the figures recorded for the vendor."}
                </p>
              </div>
              {canAmend && amendLines.length > 0 && (
                <AmendDialog orderId={orderId} lines={amendLines} />
              )}
            </div>
            <FrozenMeasurements rooms={rooms} />
          </>
        )}
      />
      <div className="mb-4">
        {order.product_line === "mesh" ? (
          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-800">Mesh vendor order</h2>
            <p className="mt-1 text-xs text-slate-500">
              Review the frozen panel measurements above, then record the manual vendor handoff.
            </p>
          </section>
        ) : (
          <PoList
            pos={pos}
            problems={poProblems}
            hasCurtains={lines.some((line) => line.line === "curtain")}
            hasBlinds={lines.some((line) => line.line === "blind")}
          />
        )}
      </div>
      {/* Nothing at all on a blinds-only or mesh order: there are no rails to
          order, and an empty card is a thing to wonder about. */}
      {(standardTrackOrder || sFoldTrackOrder || overlapTrackOrder) && (
        <div className="mb-4 space-y-3">
          {standardTrackOrder && (
            <TrackOrderCard
              title="Standard track order"
              text={standardTrackOrder}
              unmeasured={trackOrder.unmeasured
                .filter((line) => line.shipmentKind === "standard_tracks")
                .map((line) => line.label)}
            />
          )}
          {sFoldTrackOrder && (
            <TrackOrderCard
              title="S-fold track order"
              text={sFoldTrackOrder}
              unmeasured={trackOrder.unmeasured
                .filter((line) => line.shipmentKind === "s_fold_tracks")
                .map((line) => line.label)}
            />
          )}
          {overlapTrackOrder && (
            <TrackOrderCard
              title="Overlap track / attachment order"
              text={overlapTrackOrder}
              unmeasured={trackOrder.unmeasured
                .filter((line) => line.overlapTracksAttachment)
                .map((line) => line.label)}
            />
          )}
        </div>
      )}
    </>
  );
}
