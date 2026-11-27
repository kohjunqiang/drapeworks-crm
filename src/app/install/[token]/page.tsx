import { notFound } from "next/navigation";
import { z } from "zod";

import { MeshRoomSummaryCard } from "@/components/orders/mesh-room-summary-card";
import { RoomSummaryCard } from "@/components/orders/room-summary-card";
import {
  InstallationDetailsEditor,
  type EditableOpening,
} from "@/components/orders/installation-details-editor";
import { getSession } from "@/lib/auth/get-session";
import { db } from "@/lib/db/kysely";
import { isInstallerLinkActive } from "@/lib/fulfilment/installer-link";
import { canScheduleInstallation } from "@/lib/fulfilment/status";
import { loadCompletedAt } from "@/lib/fulfilment/load-completed-at";
import { loadRoomSummaries } from "@/lib/orders/load-room-summaries";
import { primaryOrderIdentifier } from "@/lib/orders/reference";
import { windowLabel } from "@/lib/orders/window-label";

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
      "orders.general_notes",
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

  // Optional staff session on the public page: ops/admin get the edit dialog,
  // consultants and anonymous installers stay read-only.
  const session = await getSession();
  const canEdit =
    (session?.profile.role === "ops" || session?.profile.role === "admin") &&
    canScheduleInstallation(arrangement.current_status);

  const {
    rooms,
    isMesh,
    windowsByRoom,
    panelsByRoom,
    photosByRoom,
    hasInstallationSizes,
    installationDetails,
    installationDetailsVersion,
    roomNotes,
  } = await loadRoomSummaries({
    id: arrangement.order_id,
    product_line: arrangement.product_line,
    current_status: arrangement.current_status,
  });

  const reference = primaryOrderIdentifier(
    arrangement.order_reference,
    arrangement.display_id,
  );

  const editableRooms = rooms.map((room) => ({
    id: room.id,
    label: room.label,
    note: roomNotes.get(room.id) ?? "",
  }));
  const editableOpenings: EditableOpening[] = rooms.flatMap((room) =>
    isMesh
      ? (panelsByRoom.get(room.id) ?? []).map((panel, index, panels) => ({
          id: panel.id,
          roomId: room.id,
          subLabel: panels.length > 1 ? `Panel ${index + 1}` : null,
          detail: panel.category_name ?? "Mesh",
          widthCm: panel.installation_width_cm ?? panel.width_cm,
          heightCm: panel.installation_height_cm ?? panel.height_cm,
          originalWidthCm: panel.frozen_width_cm ?? panel.width_cm,
          originalHeightCm: panel.frozen_height_cm ?? panel.height_cm,
          overridden: panel.installation_overridden ?? false,
          note: panel.notes ?? "",
          stored: installationDetails.openings?.[panel.id],
        }))
      : (windowsByRoom.get(room.id) ?? []).map((w, index, windows) => ({
          id: w.id,
          roomId: room.id,
          subLabel:
            windows.length > 1 || w.label
              ? windowLabel(w.position, w.label)
              : null,
          detail: w.track_only
            ? `Track only — ${w.track_kind === "double" ? "double" : "single"} track`
            : w.is_blind
              ? (w.blind_label ?? "Blinds")
              : ([w.day_curtain_label, w.night_curtain_label]
                    .filter(Boolean)
                    .join(" + ") ||
                  null) ?? "Curtain",
          widthCm: w.installation_width_cm ?? w.width_cm,
          heightCm: w.installation_height_cm ?? w.height_cm,
          originalWidthCm: w.frozen_width_cm ?? w.width_cm,
          originalHeightCm: w.frozen_height_cm ?? w.height_cm,
          overridden: w.installation_overridden ?? false,
          note: w.notes ?? "",
          stored: installationDetails.openings?.[w.id],
        })),
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
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="text-base font-semibold text-slate-900">
            Rooms &amp; measurements{" "}
            <span className="text-xs font-normal text-slate-500">(cm)</span>
          </h2>
          {canEdit ? (
            <InstallationDetailsEditor
              token={parsed.data}
              expectedVersion={installationDetailsVersion}
              generalInstructions={
                installationDetails.general_instructions ?? ""
              }
              rooms={editableRooms}
              openings={editableOpenings}
            />
          ) : null}
        </div>
        {installationDetails.general_instructions ? (
          <p className="mb-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800">
            <span className="font-medium">Instructions:</span>{" "}
            {installationDetails.general_instructions}
          </p>
        ) : null}
        {arrangement.general_notes?.trim() ? (
          <p className="mb-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 whitespace-pre-wrap break-words">
            <span className="font-medium">General note:</span>{" "}
            {arrangement.general_notes.trim()}
          </p>
        ) : null}
        {hasInstallationSizes && (
          <p className="-mt-2 mb-4 text-xs text-slate-500">
            Measured is the original site measurement. Installation is the
            finalized size confirmed at PO Ready; highlighted values are
            corrections that apply to this installation only.
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
              roomNote={roomNotes.get(r.id) ?? null}
            />
          ) : (
            <RoomSummaryCard
              key={r.id}
              label={r.label}
              type={r.type}
              windows={windowsByRoom.get(r.id) ?? []}
              photos={photosByRoom.get(r.id) ?? []}
              roomNote={roomNotes.get(r.id) ?? null}
            />
          ),
        )}
      </section>
    </main>
  );
}
