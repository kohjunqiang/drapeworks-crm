"use server";

import "server-only";

import { redirect } from "next/navigation";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth/require-role";
import { db } from "@/lib/db/kysely";
import { windowValues } from "@/lib/orders/window-values";
import { computeOrderQuote } from "@/lib/pricing/order-quote";
import { adminClient } from "@/lib/supabase/admin";
import {
  PHOTO_BUCKET,
  stampQuoteBaseline,
  sweepPhotoStorage,
} from "@/lib/actions/order-shared";
import {
  isToiletRoom,
  orderCreateSchema,
  orderDraftSchema,
  orderEditSchema,
  type OrderCreateInput,
  type OrderDraftInput,
  type OrderEditInput,
} from "@/lib/validation/order";

// The shared write-path obligations (quote baseline, photo sweep, order meta
// columns, numbering placeholders) live in order-shared.ts so the curtain and
// mesh actions can't drift apart on them.

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
        freight_mode: parsed.order.freight_mode,
        channel: parsed.order.channel,
        extra_install_sgd_cents: parsed.order.extra_install_cents,
        discount_bps: parsed.order.discount_bps,
        promo_label: parsed.order.promo_label ?? null,
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
        // A blind is one covering and is valid in EVERY room type, so it is
        // never checked against the room. Curtains still are: a toilet window
        // takes a single curtain, any other window takes day/night.
        const matchesShape =
          win.variant === "blind" ||
          (isToilet && win.variant === "toilet") ||
          (!isToilet && win.variant === "regular");
        if (!matchesShape) {
          throw new Error(
            `Window variant '${win.variant}' does not match room type '${room.type}'`,
          );
        }

        await trx
          .insertInto("windows")
          .values({ room_id: insertedRoom.id, ...windowValues(win, w) })
          .execute();
      }
    }

    await trx
      .insertInto("order_status_events")
      .values({
        order_id: order.id,
        status: "order_recorded",
        note: "Order created from consultation",
        created_by: session.user.id,
      })
      .execute();

    return order.id;
  });

  await stampQuoteBaseline(orderId);

  redirect(`/orders/${orderId}`);
}

export async function updateOrder(
  orderId: string,
  input: unknown,
): Promise<never> {
  if (typeof orderId !== "string" || orderId.length === 0) {
    throw new Error("Invalid order id");
  }

  const session = await requireRole(["consultant", "admin"]);
  const parsed: OrderEditInput = orderEditSchema.parse(input);

  const orphanStoragePaths: string[] = [];

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
        freight_mode: parsed.order.freight_mode,
        channel: parsed.order.channel,
        extra_install_sgd_cents: parsed.order.extra_install_cents,
        discount_bps: parsed.order.discount_bps,
        promo_label: parsed.order.promo_label ?? null,
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
        // A blind is one covering and is valid in EVERY room type, so it is
        // never checked against the room. Curtains still are: a toilet window
        // takes a single curtain, any other window takes day/night.
        const matchesShape =
          win.variant === "blind" ||
          (isToilet && win.variant === "toilet") ||
          (!isToilet && win.variant === "regular");
        if (!matchesShape) {
          throw new Error(
            `Window variant '${win.variant}' does not match room type '${room.type}'`,
          );
        }

        // windowValues sets every shape column explicitly (nulling the
        // opposite variant's columns), so a single update satisfies the
        // validate_window_shape trigger even when a room switches type.
        const values = windowValues(win, w);

        if (win.id) {
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

    // Before deleting rooms we capture every room_photo storage path that's
    // about to be cascade-deleted. We sweep the bucket after the DB commits
    // so a rollback doesn't leave us with deleted files but live rows.
    let orphanQ = trx
      .selectFrom("room_photos")
      .innerJoin("rooms", "rooms.id", "room_photos.room_id")
      .select("room_photos.storage_path as storage_path")
      .where("rooms.order_id", "=", orderId);
    if (keepRoomIds.length > 0) {
      orphanQ = orphanQ.where("rooms.id", "not in", keepRoomIds);
    }
    const orphanRows = await orphanQ.execute();
    orphanStoragePaths.push(...orphanRows.map((r) => r.storage_path));

    let delRooms = trx.deleteFrom("rooms").where("order_id", "=", orderId);
    if (keepRoomIds.length > 0) {
      delRooms = delRooms.where("id", "not in", keepRoomIds);
    }
    await delRooms.execute();
  });

  await sweepPhotoStorage(orphanStoragePaths, "updateOrder");

  await stampQuoteBaseline(orderId);

  revalidatePath(`/orders/${orderId}`);
  revalidatePath(`/orders/${orderId}/edit`);
  revalidatePath("/orders");

  redirect(`/orders/${orderId}`);
}

// Re-lock an order's quote to the current calculator output. Used when the
// order-detail staleness banner reports the calc has drifted from the baseline.
// Overwrites the frozen price + baseline with the live calc; deposit is left
// untouched and balance_cents (generated) re-derives from the new price.
export async function requoteOrder(orderId: string): Promise<void> {
  if (typeof orderId !== "string" || orderId.length === 0) {
    throw new Error("Invalid order id");
  }

  const session = await requireRole(["consultant", "admin"]);

  const order = await db
    .selectFrom("orders")
    .select(["id", "consultant_id"])
    .where("id", "=", orderId)
    .executeTakeFirst();
  if (!order) throw new Error("Order not found");

  const isOwner = order.consultant_id === session.user.id;
  const isAdmin = session.profile.role === "admin";
  if (!isOwner && !isAdmin) throw new Error("Forbidden");

  const quote = await computeOrderQuote(orderId);
  if (!quote) throw new Error("Nothing priced to re-quote");

  await db
    .updateTable("orders")
    .set({
      price_quoted_cents: quote.discountedSaleSgdCents,
      price_calc_at_quote_cents: quote.discountedSaleSgdCents,
    })
    .where("id", "=", orderId)
    .execute();

  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/orders");
}

export async function deleteOrder(input: {
  orderId: string;
  confirmDisplayId: string;
}): Promise<never> {
  await requireRole(["admin"]);
  if (
    typeof input?.orderId !== "string" ||
    typeof input?.confirmDisplayId !== "string"
  ) {
    throw new Error("Invalid input");
  }

  const order = await db
    .selectFrom("orders")
    .select(["id", "display_id"])
    .where("id", "=", input.orderId)
    .executeTakeFirst();
  if (!order) throw new Error("Order not found");

  if (input.confirmDisplayId.trim() !== order.display_id) {
    throw new Error(`Type ${order.display_id} exactly to confirm deletion`);
  }

  // Capture every photo's storage_path before the cascade fires so we can
  // sweep the bucket after the DB commits.
  const photos = await db
    .selectFrom("room_photos")
    .innerJoin("rooms", "rooms.id", "room_photos.room_id")
    .select("room_photos.storage_path as storage_path")
    .where("rooms.order_id", "=", order.id)
    .execute();

  // Cascades: orders → rooms → windows + room_photos, and orders →
  // order_status_events. customers.id has on-delete RESTRICT so the customer
  // row stays (preserving cross-order history).
  await db.deleteFrom("orders").where("id", "=", order.id).execute();

  if (photos.length > 0) {
    const { error } = await adminClient()
      .storage.from(PHOTO_BUCKET)
      .remove(photos.map((p) => p.storage_path));
    if (error) {
      console.error(
        "room-photo storage sweep failed during deleteOrder:",
        error.message,
      );
    }
  }

  revalidatePath("/orders");
  redirect("/orders");
}

// Saves a partially-filled consultation as a draft. Only customer.name is
// required; rooms can be empty; phone/email/dates are not strictly validated.
// The order's is_draft flag is set so the dashboard can surface drafts
// separately later.
export async function createOrderDraft(input: unknown): Promise<never> {
  const session = await requireRole(["consultant", "admin"]);
  const parsed: OrderDraftInput = orderDraftSchema.parse(input);

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
        freight_mode: parsed.order.freight_mode,
        channel: parsed.order.channel,
        extra_install_sgd_cents: parsed.order.extra_install_cents,
        discount_bps: parsed.order.discount_bps,
        promo_label: parsed.order.promo_label ?? null,
        general_notes: parsed.order.general_notes ?? null,
        is_draft: true,
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
        // Drafts are relaxed: derive the window shape from the room type rather
        // than trusting the (possibly half-filled) window variant.
        //
        // A `blind` variant is PRESERVED, never derived. Blinds are valid in
        // every room type, so there is nothing to correct — and overwriting one
        // here would null blind_type_id on every autosave, silently turning a
        // measured blind back into an empty curtain window.
        const shaped = {
          ...win,
          variant:
            win.variant === "blind"
              ? ("blind" as const)
              : isToilet
                ? ("toilet" as const)
                : ("regular" as const),
        };
        await trx
          .insertInto("windows")
          .values({ room_id: insertedRoom.id, ...windowValues(shaped, w) })
          .execute();
      }
    }

    await trx
      .insertInto("order_status_events")
      .values({
        order_id: order.id,
        status: "order_recorded",
        note: "Draft created from consultation",
        created_by: session.user.id,
      })
      .execute();

    return order.id;
  });

  await stampQuoteBaseline(orderId);

  redirect(`/orders/${orderId}`);
}
