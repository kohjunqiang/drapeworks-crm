"use server";

import "server-only";

import { sql } from "kysely";
import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth/require-role";
import { syncFulfilmentArrangement } from "@/lib/calendar/fulfilment-sync";
import { db } from "@/lib/db/kysely";
import {
  serializeInstallationDetails,
  type InstallationDetails,
} from "@/lib/fulfilment/installation-details";
import { canScheduleInstallation } from "@/lib/fulfilment/status";
import { reconcileFulfilmentStatus } from "@/lib/logistics/reconcile";
import {
  fulfilmentArrangementCancellationSchema,
  fulfilmentArrangementRetrySchema,
  fulfilmentArrangementSchema,
  installationDetailsInputSchema,
} from "@/lib/validation/fulfilment";

const sgInstant = (date: string, time: string) =>
  new Date(`${date}T${time}:00+08:00`);

function refresh(orderId: string): void {
  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/orders");
}

export async function saveFulfilmentArrangement(input: unknown): Promise<void> {
  const session = await requireRole(["ops", "admin"]);
  const parsed = fulfilmentArrangementSchema.parse(input);
  const scheduledAt = sgInstant(parsed.date, parsed.time);

  const arrangementId = await db.transaction().execute(async (trx) => {
    const order = await trx
      .selectFrom("orders")
      .select("current_status")
      .where("id", "=", parsed.order_id)
      .forUpdate()
      .executeTakeFirst();
    if (!order) throw new Error("Order not found");
    if (!canScheduleInstallation(order.current_status)) {
      throw new Error(
        "Installation can be scheduled after the PO measurements are ready and before the order is completed",
      );
    }

    const previousArrangement = await trx
      .selectFrom("fulfilment_arrangements")
      .select(["id", "cancelled_at"])
      .where("order_id", "=", parsed.order_id)
      .executeTakeFirst();

    const arrangement = await trx
      .insertInto("fulfilment_arrangements")
      .values({
        order_id: parsed.order_id,
        scheduled_at: scheduledAt,
        duration_mins: parsed.duration_mins,
        address: parsed.address,
        google_sync_state: "pending",
        google_sync_error: null,
        created_by: session.user.id,
      })
      .onConflict((conflict) =>
        conflict.column("order_id").doUpdateSet({
          scheduled_at: scheduledAt,
          duration_mins: parsed.duration_mins,
          address: parsed.address,
          google_sync_state: "pending",
          google_sync_error: null,
          cancelled_at: null,
          cancelled_by: null,
          cancellation_reason: null,
          // A re-book after a cancellation must not resurrect the installer
          // link that was already sent out — mint a fresh token. A plain
          // reschedule keeps the existing one so the sent link keeps working.
          ...(previousArrangement?.cancelled_at
            ? { installer_token: sql`gen_random_uuid()` }
            : {}),
        }),
      )
      .returning("id")
      .executeTakeFirstOrThrow();

    await trx
      .insertInto("fulfilment_arrangement_events")
      .values({
        arrangement_id: arrangement.id,
        event_type:
          !previousArrangement || previousArrangement.cancelled_at
            ? "booked"
            : "rescheduled",
        scheduled_at: scheduledAt,
        duration_mins: parsed.duration_mins,
        address: parsed.address,
        cancellation_reason: null,
        created_by: session.user.id,
      })
      .execute();

    // Booking is the structured action that moves an order into the
    // Fulfillment Arrangement stage once every required shipment has arrived.
    // Booking earlier is calendar planning only; the reconciliation catches the
    // status up — whether the booking lands before or after the last arrival.
    await reconcileFulfilmentStatus(trx, {
      orderId: parsed.order_id,
      createdBy: session.user.id,
      fulfilmentNote: `Installation booked for ${parsed.date} ${parsed.time}`,
    });
    return arrangement.id;
  });

  await syncFulfilmentArrangement(arrangementId);
  refresh(parsed.order_id);
}

export async function cancelFulfilmentArrangement(input: unknown): Promise<void> {
  const session = await requireRole(["ops", "admin"]);
  const parsed = fulfilmentArrangementCancellationSchema.parse(input);

  const arrangementId = await db.transaction().execute(async (trx) => {
    const order = await trx
      .selectFrom("orders")
      .select("current_status")
      .where("id", "=", parsed.order_id)
      .forUpdate()
      .executeTakeFirst();
    if (!order) throw new Error("Order not found");
    if (!canScheduleInstallation(order.current_status)) {
      throw new Error(
        "Installation can only be cancelled after the PO measurements are ready and before the order is completed",
      );
    }

    const arrangement = await trx
      .selectFrom("fulfilment_arrangements")
      .select([
        "id",
        "cancelled_at",
        "scheduled_at",
        "duration_mins",
        "address",
      ])
      .where("order_id", "=", parsed.order_id)
      .executeTakeFirst();
    if (!arrangement || arrangement.cancelled_at) {
      throw new Error("There is no active installation booking to cancel");
    }

    await trx
      .updateTable("fulfilment_arrangements")
      .set({
        cancelled_at: new Date(),
        cancelled_by: session.user.id,
        cancellation_reason: parsed.reason,
        google_sync_state: "pending",
        google_sync_error: null,
      })
      .where("id", "=", arrangement.id)
      .execute();

    await trx
      .insertInto("fulfilment_arrangement_events")
      .values({
        arrangement_id: arrangement.id,
        event_type: "cancelled",
        scheduled_at: arrangement.scheduled_at,
        duration_mins: arrangement.duration_mins,
        address: arrangement.address,
        cancellation_reason: parsed.reason,
        created_by: session.user.id,
      })
      .execute();

    // The booking is the action that entered Fulfillment Arrangement, so its
    // cancellation returns the order to Delivered & Checked with an audit note.
    if (order.current_status === "fulfilment") {
      await trx
        .insertInto("order_status_events")
        .values({
          order_id: parsed.order_id,
          status: "delivered_checked",
          note: `[INSTALLATION CANCELLED] ${parsed.reason}`,
          created_by: session.user.id,
        })
        .execute();
    }

    return arrangement.id;
  });

  const result = await syncFulfilmentArrangement(arrangementId);
  refresh(parsed.order_id);
  if (!result.ok) {
    throw new Error(
      "Installation cancelled, but its Calendar event could not be removed. Retry Calendar sync from the order.",
    );
  }
}

/**
 * Rotate the public installer link for an active booking. The old link stops
 * working at once; the copied details pick up the new URL on the next render.
 */
export async function resetInstallerLink(input: unknown): Promise<void> {
  await requireRole(["ops", "admin"]);
  const parsed = fulfilmentArrangementRetrySchema.parse(input);
  const updated = await db
    .updateTable("fulfilment_arrangements")
    .set({ installer_token: sql`gen_random_uuid()` })
    .where("order_id", "=", parsed.order_id)
    .where("cancelled_at", "is", null)
    .returning("id")
    .executeTakeFirst();
  if (!updated) throw new Error("No active installation booking");
  refresh(parsed.order_id);
}

/**
 * Save installation-detail overrides for the booking behind a public
 * installer link. Ops/admin only — consultants and anonymous link viewers
 * stay read-only. The write corrects what the installer sees (instructions,
 * room notes, opening sizes/notes) and never touches the quoted windows,
 * measured dimensions or frozen PO data. Calendar is deliberately not synced:
 * the next summary generation reads the saved overrides.
 */
export async function saveInstallationDetails(input: unknown): Promise<void> {
  const session = await requireRole(["ops", "admin"]);
  const parsed = installationDetailsInputSchema.parse(input);

  const orderId = await db.transaction().execute(async (tx) => {

    // The write is keyed by the live public token — a rotated or cancelled
    // link matches nothing here, so stale links lose write access at once.
    const found = await tx
      .selectFrom("fulfilment_arrangements")
      .select(["id", "order_id", "cancelled_at"])
      .where("installer_token", "=", parsed.token)
      .executeTakeFirst();
    if (!found || found.cancelled_at) {
      throw new Error("There is no active installation booking for this link");
    }

    // Lock the order, then the booking — same order as the booking actions.
    const order = await tx
      .selectFrom("orders")
      .select(["id", "current_status", "product_line"])
      .where("id", "=", found.order_id)
      .forUpdate()
      .executeTakeFirst();
    if (!order) throw new Error("Order not found");
    if (!canScheduleInstallation(order.current_status)) {
      throw new Error(
        "Installation details can only be edited on an active booking before the order is completed",
      );
    }

    const locked = await tx
      .selectFrom("fulfilment_arrangements")
      .select([
        "id",
        "installer_token",
        "cancelled_at",
        "installation_details_version",
      ])
      .where("id", "=", found.id)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (locked.cancelled_at || locked.installer_token !== parsed.token) {
      throw new Error("There is no active installation booking for this link");
    }
    if (locked.installation_details_version !== parsed.expected_version) {
      throw new Error(
        "These installation details were changed elsewhere. Reload the page and try again.",
      );
    }

    const roomRows = await tx
      .selectFrom("rooms")
      .select("id")
      .where("order_id", "=", order.id)
      .execute();
    const roomIds = new Set(roomRows.map((room) => room.id));

    const seenRooms = new Set<string>();
    for (const entry of parsed.rooms) {
      if (!roomIds.has(entry.room_id)) {
        throw new Error("A room note references a room that is not on this order");
      }
      if (seenRooms.has(entry.room_id)) {
        throw new Error("Duplicate room note");
      }
      seenRooms.add(entry.room_id);
    }

    // Openings are windows for curtain/blind orders and mesh panels for mesh
    // orders — an id from the wrong product line or another order is rejected.
    const openingIds = new Set<string>();
    if (order.product_line === "mesh" && roomIds.size > 0) {
      for (const row of await tx
        .selectFrom("mesh_panels")
        .select("id")
        .where("room_id", "in", [...roomIds])
        .execute()) {
        openingIds.add(row.id);
      }
    } else if (order.product_line !== "mesh" && roomIds.size > 0) {
      for (const row of await tx
        .selectFrom("windows")
        .select("id")
        .where("room_id", "in", [...roomIds])
        .execute()) {
        openingIds.add(row.id);
      }
    }

    const seenOpenings = new Set<string>();
    for (const entry of parsed.openings) {
      if (!openingIds.has(entry.opening_id)) {
        throw new Error(
          "An installation correction references an opening that is not on this order",
        );
      }
      if (seenOpenings.has(entry.opening_id)) {
        throw new Error("Duplicate installation correction");
      }
      seenOpenings.add(entry.opening_id);
    }

    const details: InstallationDetails = {
      general_instructions: parsed.general_instructions?.trim() || null,
      rooms: Object.fromEntries(
        parsed.rooms
          .filter((entry) => entry.note !== "")
          .map((entry) => [entry.room_id, { note: entry.note }]),
      ),
      openings: Object.fromEntries(
        parsed.openings.map((entry) => [
          entry.opening_id,
          {
            width_cm: entry.width_cm ?? null,
            height_cm: entry.height_cm ?? null,
            note: entry.note ?? null,
          },
        ]),
      ),
    };

    await tx
      .updateTable("fulfilment_arrangements")
      .set({
        installation_details: serializeInstallationDetails(details),
        installation_details_version: parsed.expected_version + 1,
      })
      .where("id", "=", locked.id)
      .where(
        "installation_details_version",
        "=",
        parsed.expected_version,
      )
      .execute();

    // Same-status audit note: the correction is visible in the order timeline
    // without pretending the order moved.
    await tx
      .insertInto("order_status_events")
      .values({
        order_id: order.id,
        status: order.current_status,
        note: "[INSTALLATION DETAILS UPDATED] Corrections to installation instructions, room notes or sizes",
        created_by: session.user.id,
      })
      .execute();

    return order.id;
  });

  revalidatePath(`/install/${parsed.token}`);
  refresh(orderId);
}

export async function retryFulfilmentSync(input: unknown): Promise<void> {
  await requireRole(["ops", "admin"]);
  const parsed = fulfilmentArrangementRetrySchema.parse(input);
  const arrangement = await db
    .selectFrom("fulfilment_arrangements")
    .select("id")
    .where("order_id", "=", parsed.order_id)
    .executeTakeFirstOrThrow();
  const result = await syncFulfilmentArrangement(arrangement.id);
  refresh(parsed.order_id);
  if (!result.ok) {
    throw new Error(
      "Calendar sync failed again. The installation change is still saved.",
    );
  }
}
