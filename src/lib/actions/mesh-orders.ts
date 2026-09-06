"use server";

import "server-only";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  completeAppointmentForOrder,
  resolveOrderCustomer,
} from "@/lib/actions/order-customer";
import { requireRole } from "@/lib/auth/require-role";
import { db } from "@/lib/db/kysely";
import { loadActiveMeshSystemBands } from "@/lib/db/mesh-catalogue";
import { meshPanelValues } from "@/lib/orders/mesh-panel-values";
import { meshSystemProblems } from "@/lib/orders/mesh-system";
import { isLocked } from "@/lib/status-flow";
import {
  SEQ_PLACEHOLDERS,
  cloneTemplateRoomPhotos,
  collectOrphanPhotoPaths,
  deleteDroppedRooms,
  orderMetaColumns,
  stampQuoteBaseline,
  sweepPhotoStorage,
} from "@/lib/actions/order-shared";
import {
  meshOrderCreateSchema,
  meshOrderDraftSchema,
  meshOrderEditSchema,
  type MeshDraw,
  type MeshOrderCreateInput,
  type MeshOrderDraftInput,
  type MeshOrderEditInput,
} from "@/lib/validation/mesh";

// Mesh consultations. Parallel to actions/orders.ts rather than branching
// inside it: the line-item half shares nothing with curtains, while the order
// shell obligations are shared through actions/order-shared.ts.
//
// `product_line: 'mesh'` is written here, in the insert. It appears in no Zod
// schema anywhere, so no request can set or change it.

/**
 * Reject any panel no track system can be built for (§5.9).
 *
 * This cannot live in the Zod schema: resolution needs the system matrix, which
 * is database state the schema has no access to. So it runs here, after parse
 * and before the transaction — the form performs the same check for immediate
 * feedback, but the form is not the only writer and this is the guarantee.
 *
 * Deliberately blocking, unlike every other mesh check. An unpriced panel is a
 * quote that needs attention; an unbuildable one is an order the factory cannot
 * fulfil, and it must not be possible to place.
 *
 * Drafts are exempt — a half-measured panel is the normal state of a draft.
 */
async function assertBuildable(rooms: {
  panels: { width_cm: number | null; draw?: MeshDraw }[];
}[]): Promise<void> {
  const bands = await loadActiveMeshSystemBands();
  const problems = meshSystemProblems(
    rooms.map((r) => ({
      panels: r.panels.map((p) => ({ widthCm: p.width_cm, draw: p.draw })),
    })),
    bands,
  );

  if (problems.length > 0) {
    throw new Error(problems[0].message);
  }
}

export async function createMeshOrder(input: unknown): Promise<never> {
  const session = await requireRole(["consultant", "admin"]);
  const parsed: MeshOrderCreateInput = meshOrderCreateSchema.parse(input);
  await assertBuildable(parsed.rooms);

  const copiedPhotoPaths: string[] = [];
  let orderId: string;
  try {
    orderId = await db.transaction().execute(async (trx) => {
    const customer = await resolveOrderCustomer(
      trx,
      parsed.appointment_id,
      parsed.lead_id,
      parsed.customer,
      session.user.id,
      parsed.customer_id,
    );

    const order = await trx
      .insertInto("orders")
      .values({
        customer_id: customer.customerId,
        appointment_id: customer.appointmentId,
        lead_id: customer.leadId,
        consultant_id: session.user.id,
        product_line: "mesh",
        ...orderMetaColumns(parsed.order),
        ...SEQ_PLACEHOLDERS,
      })
      .returning(["id", "display_id"])
      .executeTakeFirstOrThrow();

    for (let r = 0; r < parsed.rooms.length; r++) {
      const room = parsed.rooms[r];
      const insertedRoom = await trx
        .insertInto("rooms")
        .values({
          order_id: order.id,
          type: room.type,
          label: room.label,
          position: r,
        })
        .returning("id")
        .executeTakeFirstOrThrow();

      for (let p = 0; p < room.panels.length; p++) {
        await trx
          .insertInto("mesh_panels")
          .values({
            room_id: insertedRoom.id,
            ...meshPanelValues(room.panels[p], p),
          })
          .execute();
      }

      if (room.template_room_id) {
        await cloneTemplateRoomPhotos(trx, {
          sourceRoomId: room.template_room_id,
          targetRoomId: insertedRoom.id,
          targetOrderId: order.id,
          customerId: customer.customerId,
          productLine: "mesh",
          uploadedBy: session.user.id,
          copiedPaths: copiedPhotoPaths,
        });
      }
    }

    // Seeds the status timeline. Without it the order detail page shows an
    // empty history.
    await trx
      .insertInto("order_status_events")
      .values({
        order_id: order.id,
        status: "order_recorded",
        note: "Mesh order created from consultation",
        created_by: session.user.id,
      })
      .execute();

    if (!parsed.order.is_draft) {
      await completeAppointmentForOrder(
        trx,
        customer.appointmentId,
        customer.leadId,
        session.user.id,
      );
    }

      return order.id;
    });
  } catch (error) {
    await sweepPhotoStorage(copiedPhotoPaths, "createMeshOrder template rollback");
    throw error;
  }

  await stampQuoteBaseline(orderId);

  redirect(`/orders/${orderId}`);
}

export async function updateMeshOrder(
  orderId: string,
  input: unknown,
  returnRoomIds = false,
): Promise<{ roomIds: string[] }> {
  if (typeof orderId !== "string" || orderId.length === 0) {
    throw new Error("Invalid order id");
  }

  const session = await requireRole(["consultant", "admin"]);
  const parsed: MeshOrderEditInput = meshOrderEditSchema.parse(input);
  await assertBuildable(parsed.rooms);

  const orphanStoragePaths: string[] = [];

  const roomIds = await db.transaction().execute(async (trx) => {
    const order = await trx
      .selectFrom("orders")
      .select([
        "id",
        "customer_id",
        "consultant_id",
        "product_line",
        "current_status",
        "is_draft",
        "appointment_id",
        "lead_id",
      ])
      .where("id", "=", orderId)
      .forUpdate()
      .executeTakeFirst();
    if (!order) throw new Error("Order not found");
    if (order.product_line !== "mesh") {
      throw new Error("Not a mesh order");
    }

    const isOwner = order.consultant_id === session.user.id;
    const isAdmin = session.profile.role === "admin";
    if (!isOwner && !isAdmin) throw new Error("Forbidden");

    if (isLocked(order.current_status)) {
      throw new Error(
        "This order is locked — it has been sent to the vendor. Ask an admin to amend the manufacturing measurements instead.",
      );
    }

    await trx
      .updateTable("customers")
      .set({
        name: parsed.customer.name,
        mobile: parsed.customer.mobile,
        email: parsed.customer.email ?? null,
      })
      .where("id", "=", order.customer_id)
      .execute();

    // product_line is deliberately absent — an order's product line is
    // immutable, and no edit schema can express it.
    await trx
      .updateTable("orders")
      .set(orderMetaColumns(parsed.order))
      .where("id", "=", orderId)
      .execute();

    const keepRoomIds: string[] = [];

    for (let r = 0; r < parsed.rooms.length; r++) {
      const room = parsed.rooms[r];
      let roomId = room.id;

      if (roomId) {
        await trx
          .updateTable("rooms")
          .set({ type: room.type, label: room.label, position: r })
          .where("id", "=", roomId)
          .where("order_id", "=", orderId)
          .execute();
      } else {
        const inserted = await trx
          .insertInto("rooms")
          .values({
            order_id: orderId,
            type: room.type,
            label: room.label,
            position: r,
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        roomId = inserted.id;
      }
      keepRoomIds.push(roomId);

      const keepPanelIds: string[] = [];

      for (let p = 0; p < room.panels.length; p++) {
        const values = meshPanelValues(room.panels[p], p);

        if (room.panels[p].id) {
          await trx
            .updateTable("mesh_panels")
            .set(values)
            .where("id", "=", room.panels[p].id!)
            .where("room_id", "=", roomId)
            .execute();
          keepPanelIds.push(room.panels[p].id!);
        } else {
          const inserted = await trx
            .insertInto("mesh_panels")
            .values({ room_id: roomId, ...values })
            .returning("id")
            .executeTakeFirstOrThrow();
          keepPanelIds.push(inserted.id);
        }
      }

      // Reconciliation, not just upsert: a panel the consultant removed in the
      // form has no id in the payload, so without this delete the row survives
      // and the order keeps quoting AND installing a panel that isn't there.
      let delPanels = trx
        .deleteFrom("mesh_panels")
        .where("room_id", "=", roomId);
      if (keepPanelIds.length > 0) {
        delPanels = delPanels.where("id", "not in", keepPanelIds);
      }
      await delPanels.execute();
    }

    // Capture photo paths BEFORE the room cascade fires; sweep after commit.
    orphanStoragePaths.push(
      ...(await collectOrphanPhotoPaths(trx, orderId, keepRoomIds)),
    );
    await deleteDroppedRooms(trx, orderId, keepRoomIds);

    if (order.is_draft && !parsed.order.is_draft) {
      await completeAppointmentForOrder(
        trx,
        order.appointment_id,
        order.lead_id,
        session.user.id,
      );
    }

    return keepRoomIds;
  });

  await sweepPhotoStorage(orphanStoragePaths, "updateMeshOrder");
  await stampQuoteBaseline(orderId);

  revalidatePath(`/orders/${orderId}`);
  revalidatePath(`/orders/${orderId}/edit`);
  revalidatePath("/orders");

  if (returnRoomIds !== true) redirect(`/orders/${orderId}`);
  return { roomIds };
}

// Saves a partially-filled mesh consultation. Only customer.name is required;
// rooms and panels can be empty.
export async function createMeshOrderDraft(input: unknown): Promise<never> {
  const session = await requireRole(["consultant", "admin"]);
  const parsed: MeshOrderDraftInput = meshOrderDraftSchema.parse(input);

  const copiedPhotoPaths: string[] = [];
  let orderId: string;
  try {
    orderId = await db.transaction().execute(async (trx) => {
    const customer = await resolveOrderCustomer(
      trx,
      parsed.appointment_id,
      parsed.lead_id,
      parsed.customer,
      session.user.id,
      parsed.customer_id,
    );

    const order = await trx
      .insertInto("orders")
      .values({
        customer_id: customer.customerId,
        appointment_id: customer.appointmentId,
        lead_id: customer.leadId,
        consultant_id: session.user.id,
        product_line: "mesh",
        ...orderMetaColumns({ ...parsed.order, is_draft: true }),
        ...SEQ_PLACEHOLDERS,
      })
      .returning(["id", "display_id"])
      .executeTakeFirstOrThrow();

    for (let r = 0; r < parsed.rooms.length; r++) {
      const room = parsed.rooms[r];
      const insertedRoom = await trx
        .insertInto("rooms")
        .values({
          order_id: order.id,
          type: room.type,
          label: room.label,
          position: r,
        })
        .returning("id")
        .executeTakeFirstOrThrow();

      for (let p = 0; p < room.panels.length; p++) {
        await trx
          .insertInto("mesh_panels")
          .values({
            room_id: insertedRoom.id,
            ...meshPanelValues(room.panels[p], p),
          })
          .execute();
      }

      if (room.template_room_id) {
        await cloneTemplateRoomPhotos(trx, {
          sourceRoomId: room.template_room_id,
          targetRoomId: insertedRoom.id,
          targetOrderId: order.id,
          customerId: customer.customerId,
          productLine: "mesh",
          uploadedBy: session.user.id,
          copiedPaths: copiedPhotoPaths,
        });
      }
    }

    await trx
      .insertInto("order_status_events")
      .values({
        order_id: order.id,
        status: "order_recorded",
        note: "Mesh draft created from consultation",
        created_by: session.user.id,
      })
      .execute();

      return order.id;
    });
  } catch (error) {
    await sweepPhotoStorage(copiedPhotoPaths, "createMeshOrderDraft template rollback");
    throw error;
  }

  await stampQuoteBaseline(orderId);

  redirect(`/orders/${orderId}`);
}
