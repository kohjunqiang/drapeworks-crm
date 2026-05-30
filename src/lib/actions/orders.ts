"use server";

import "server-only";

import { redirect } from "next/navigation";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth/require-role";
import { db } from "@/lib/db/kysely";
import {
  isToiletRoom,
  orderCreateSchema,
  orderEditSchema,
  type OrderCreateInput,
  type OrderEditInput,
  type WindowEditInput,
} from "@/lib/validation/order";

export async function createOrder(input: unknown): Promise<never> {
  const session = await requireRole(["consultant", "admin"]);
  const parsed: OrderCreateInput = orderCreateSchema.parse(input);

  const orderId = await db.transaction().execute(async (trx) => {
    const customer = await trx
      .insertInto("customers")
      .values({
        name: parsed.customer.name,
        mobile: parsed.customer.mobile,
        email: parsed.customer.email ?? null,
        created_by: session.user.id,
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    const order = await trx
      .insertInto("orders")
      .values({
        customer_id: customer.id,
        consultant_id: session.user.id,
        property_type: parsed.order.property_type ?? null,
        development: parsed.order.development ?? null,
        unit_type: parsed.order.unit_type ?? null,
        move_in_date: parsed.order.move_in_date
          ? parsed.order.move_in_date
          : null,
        price_quoted_cents: parsed.order.price_quoted_cents,
        deposit_cents: parsed.order.deposit_cents,
        general_notes: parsed.order.general_notes ?? null,
        is_draft: parsed.order.is_draft,
        // display_id / seq_year / seq_num populated by trigger
        seq_year: 0,
        seq_num: 0,
        display_id: "",
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

      const isToilet = isToiletRoom(room.type);

      for (let w = 0; w < room.windows.length; w++) {
        const win = room.windows[w];

        if (isToilet && win.variant === "toilet") {
          await trx
            .insertInto("windows")
            .values({
              room_id: insertedRoom.id,
              position: w,
              width_cm: win.width_cm ?? null,
              height_cm: win.height_cm ?? null,
              install_width_cm: win.install_width_cm ?? null,
              notes: win.notes || null,
              curtain_code: win.curtain_code || null,
            })
            .execute();
        } else if (!isToilet && win.variant === "regular") {
          await trx
            .insertInto("windows")
            .values({
              room_id: insertedRoom.id,
              position: w,
              width_cm: win.width_cm ?? null,
              height_cm: win.height_cm ?? null,
              install_width_cm: win.install_width_cm ?? null,
              notes: win.notes || null,
              day_curtain_code: win.day_curtain_code || null,
              night_curtain_code: win.night_curtain_code || null,
              draw: win.draw ?? null,
            })
            .execute();
        } else {
          throw new Error(
            `Window variant '${win.variant}' does not match room type '${room.type}'`,
          );
        }
      }
    }

    await trx
      .insertInto("order_status_events")
      .values({
        order_id: order.id,
        status: "order_made",
        note: "Order created from consultation",
        created_by: session.user.id,
      })
      .execute();

    return order.id;
  });

  redirect(`/orders/${orderId}`);
}

function regularWindowValues(win: Extract<WindowEditInput, { variant: "regular" }>, position: number) {
  return {
    position,
    width_cm: win.width_cm ?? null,
    height_cm: win.height_cm ?? null,
    install_width_cm: win.install_width_cm ?? null,
    notes: win.notes || null,
    day_curtain_code: win.day_curtain_code || null,
    night_curtain_code: win.night_curtain_code || null,
    draw: win.draw ?? null,
    curtain_code: null,
  } as const;
}

function toiletWindowValues(win: Extract<WindowEditInput, { variant: "toilet" }>, position: number) {
  return {
    position,
    width_cm: win.width_cm ?? null,
    height_cm: win.height_cm ?? null,
    install_width_cm: win.install_width_cm ?? null,
    notes: win.notes || null,
    curtain_code: win.curtain_code || null,
    day_curtain_code: null,
    night_curtain_code: null,
    draw: null,
  } as const;
}

export async function updateOrder(orderId: string, input: unknown): Promise<never> {
  if (typeof orderId !== "string" || orderId.length === 0) {
    throw new Error("Invalid order id");
  }

  const session = await requireRole(["consultant", "admin"]);
  const parsed: OrderEditInput = orderEditSchema.parse(input);

  await db.transaction().execute(async (trx) => {
    const order = await trx
      .selectFrom("orders")
      .select(["id", "customer_id", "consultant_id"])
      .where("id", "=", orderId)
      .executeTakeFirst();
    if (!order) throw new Error("Order not found");

    const isOwner = order.consultant_id === session.user.id;
    const isAdmin = session.profile.role === "admin";
    if (!isOwner && !isAdmin) {
      throw new Error("Forbidden");
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

    await trx
      .updateTable("orders")
      .set({
        property_type: parsed.order.property_type ?? null,
        development: parsed.order.development ?? null,
        unit_type: parsed.order.unit_type ?? null,
        move_in_date: parsed.order.move_in_date ?? null,
        price_quoted_cents: parsed.order.price_quoted_cents,
        deposit_cents: parsed.order.deposit_cents,
        general_notes: parsed.order.general_notes ?? null,
        is_draft: parsed.order.is_draft,
      })
      .where("id", "=", orderId)
      .execute();

    const keepRoomIds: string[] = [];

    for (let r = 0; r < parsed.rooms.length; r++) {
      const room = parsed.rooms[r];
      let roomId = room.id;
      const isToilet = isToiletRoom(room.type);

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

      const keepWindowIds: string[] = [];

      for (let w = 0; w < room.windows.length; w++) {
        const win = room.windows[w];
        const matchesShape =
          (isToilet && win.variant === "toilet") ||
          (!isToilet && win.variant === "regular");
        if (!matchesShape) {
          throw new Error(
            `Window variant '${win.variant}' does not match room type '${room.type}'`,
          );
        }

        const values =
          win.variant === "toilet"
            ? toiletWindowValues(win, w)
            : regularWindowValues(win, w);

        if (win.id) {
          // Clear the opposite-shape columns to satisfy the window-shape trigger
          // when a room is converted from regular to toilet (or vice versa) and
          // existing window rows are being kept.
          await trx
            .updateTable("windows")
            .set({
              curtain_code: null,
              day_curtain_code: null,
              night_curtain_code: null,
              draw: null,
            })
            .where("id", "=", win.id)
            .where("room_id", "=", roomId)
            .execute();

          await trx
            .updateTable("windows")
            .set(values)
            .where("id", "=", win.id)
            .where("room_id", "=", roomId)
            .execute();
          keepWindowIds.push(win.id);
        } else {
          const insertedWin = await trx
            .insertInto("windows")
            .values({ room_id: roomId, ...values })
            .returning("id")
            .executeTakeFirstOrThrow();
          keepWindowIds.push(insertedWin.id);
        }
      }

      let delWindows = trx.deleteFrom("windows").where("room_id", "=", roomId);
      if (keepWindowIds.length > 0) {
        delWindows = delWindows.where("id", "not in", keepWindowIds);
      }
      await delWindows.execute();
    }

    let delRooms = trx.deleteFrom("rooms").where("order_id", "=", orderId);
    if (keepRoomIds.length > 0) {
      delRooms = delRooms.where("id", "not in", keepRoomIds);
    }
    await delRooms.execute();
  });

  revalidatePath(`/orders/${orderId}`);
  revalidatePath(`/orders/${orderId}/edit`);
  revalidatePath("/orders");

  redirect(`/orders/${orderId}`);
}
