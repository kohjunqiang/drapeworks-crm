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
import { PoList, type PoListItem } from "@/components/manufacture/po-list";
import { TrackOrderCard } from "@/components/manufacture/track-order-card";
import {
  Reconciliation,
  type ReconRoom,
} from "@/components/manufacture/reconciliation";
import type { ReconLine } from "@/components/manufacture/reconciliation-row";
import { StatusBadge } from "@/components/orders/status-badge";
import { requireSession } from "@/lib/auth/require-role";
import { db } from "@/lib/db/kysely";
import { loadOrderPos } from "@/lib/db/procurement";
import { buildPos } from "@/lib/po/build";
import { loadPoInput } from "@/lib/po/load";
import { trackOrderText } from "@/lib/po/track-order";
import { loadTrackOrder } from "@/lib/po/track-order-load";
import { applyAllowance, resolveAllowance } from "@/lib/manufacture/allowance";
import type { AllowanceLine } from "@/lib/manufacture/allowance";
import {
  loadAllowanceBook,
  loadManufactureLines,
  type ManufactureLine,
} from "@/lib/manufacture/load";
import type { FulfilmentStatus } from "@/lib/db/schema";
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
      "orders.current_status as current_status",
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

  const locked = isLocked(order.current_status);
  const lines = await loadManufactureLines(order.id);

  return (
    <Shell order={order}>
      {locked ? (
        <FrozenView
          orderId={order.id}
          lines={lines}
          canAmend={session.profile.role === "admin"}
        />
      ) : (
        <EditableView
          order={order}
          lines={lines}
          isAdmin={session.profile.role === "admin"}
        />
      )}
    </Shell>
  );
}

type OrderHeader = {
  id: string;
  display_id: string;
  order_reference: string | null;
  current_status: FulfilmentStatus;
  customer_name: string;
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
            {order.order_reference && ` · Ref ${order.order_reference}`}
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
  lines,
  canAmend,
}: {
  orderId: string;
  lines: ManufactureLine[];
  canAmend: boolean;
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
  const poProblems = poLoad.input
    ? buildPos(poLoad.input).problems
    : poLoad.problems;
  const pos: PoListItem[] = poRows.map((row) => ({
    id: row.id,
    vendorName: row.vendor_name,
    vendorNameCn: row.vendor_name_cn,
    poNumber: row.po_number,
    generatedLabel: SG_DATE_TIME.format(new Date(row.generated_at)),
    supersededLabel: row.superseded_at
      ? SG_DATE_TIME.format(new Date(row.superseded_at))
      : null,
    notes: row.notes,
  }));

  // Built on the server so the page ships the finished text: what is copied is
  // exactly what is on screen, with no second assembly in the browser.
  const trackOrderLines = trackOrderText(trackOrder.lines, trackOrder.noteCn);

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
      <div className="mb-4 rounded-lg border border-slate-200 bg-white p-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <p className="text-sm text-slate-600">
          These measurements are frozen. They are what the vendor was given
          {confirmedAt && ` on ${SG_DATE.format(confirmedAt)}`}, and they do not
          change if an allowance is edited later.
        </p>
        {canAmend && amendLines.length > 0 && (
          <div className="self-start">
            <AmendDialog orderId={orderId} lines={amendLines} />
          </div>
        )}
      </div>
      <div className="mb-4">
        <PoList orderId={orderId} pos={pos} problems={poProblems} />
      </div>
      {/* Nothing at all on a blinds-only or mesh order: there are no rails to
          order, and an empty card is a thing to wonder about. */}
      {trackOrderLines && (
        <div className="mb-4">
          <TrackOrderCard
            text={trackOrderLines}
            unmeasured={trackOrder.unmeasured}
          />
        </div>
      )}
      <FrozenMeasurements rooms={rooms} />
    </>
  );
}
