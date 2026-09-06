"use server";

import "server-only";

import { redirect } from "next/navigation";

import { revalidatePath } from "next/cache";
import { sql, type Transaction } from "kysely";

import { requireRole } from "@/lib/auth/require-role";
import {
  completeAppointmentForOrder,
  resolveOrderCustomer,
} from "@/lib/actions/order-customer";
import { db } from "@/lib/db/kysely";
import type { DB } from "@/lib/db/schema";
import { COMPLETION_PHOTO_BUCKET } from "@/lib/db/completion-photos";
import { fulfilmentCalendarEventId } from "@/lib/calendar/fulfilment-event-id";
import { syncFulfilmentArrangement } from "@/lib/calendar/fulfilment-sync";
import { deleteEvent, isCalendarConfigured } from "@/lib/calendar/google";
import {
  loadAddonCatalogue,
  loadWindowAddonIds,
} from "@/lib/db/window-addons";
import { userMessage } from "@/lib/errors";
import {
  resolveWindowAddons,
  selectedAddonIds,
  type AddonRule,
} from "@/lib/orders/window-addons";
import { windowValues } from "@/lib/orders/window-values";
import { computeOrderQuote, loadCurtainRates } from "@/lib/pricing/order-quote";
import { loadCurtainPackages } from "@/lib/db/product-pricing-settings";
import { makePackageContext, packagePricingSignature, readPackageContext, resolveCurtainPackageQuote, type CurtainPackageContext } from "@/lib/pricing/curtain-package-rules";
import { toCalcAddons } from "@/lib/orders/window-addons";
import { isLocked } from "@/lib/status-flow";
import { primaryOrderIdentifier } from "@/lib/orders/reference";
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
  orderReferenceSchema,
  type OrderCreateInput,
  type OrderDraftInput,
  type OrderEditInput,
} from "@/lib/validation/order";

async function resolveCurtainPackage(order: {
  curtain_package_id?: string;
  curtain_package_tier?: "essential" | "tier2";
  curtain_package_single_layer?: "day" | "night";
  curtain_package_pricing_signature?: string;
}, allowInactiveId?: string | null, savedRules?: unknown) {
  if (!order.curtain_package_id) {
    return { values: {
        curtain_package_id: null, curtain_package_name: null,
        curtain_package_type: null, curtain_package_tier: null,
        curtain_package_sale_sgd_cents: null,
        curtain_package_rules: null,
      } as const, rules: null, inputSignature: order.curtain_package_pricing_signature };
  }
  const saved = readPackageContext(savedRules);
  const item = (await loadCurtainPackages()).find((item) => item.id === order.curtain_package_id);
  if (!item || (!item.isActive && item.id !== allowInactiveId)) {
    throw new Error("Select an active curtain package");
  }
  const tier = order.curtain_package_tier ?? "essential";
  const singleLayer = order.curtain_package_single_layer ?? "night";
  const rules: CurtainPackageContext = saved?.id === item.id
    ? { ...saved, tier, singleLayer }
    : makePackageContext(item, tier, singleLayer, await loadCurtainRates());
  if (tier === "tier2" && rules.tier2UpgradeCents == null) {
    throw new Error("This package does not offer Tier 2");
  }
  return { values: {
    curtain_package_id: item.id,
    curtain_package_name: rules.name,
    curtain_package_type: rules.packageType,
    curtain_package_tier: tier,
    curtain_package_sale_sgd_cents:
      rules.baseCents + (tier === "tier2" ? rules.tier2UpgradeCents ?? 0 : 0),
    curtain_package_rules: rules,
    } as const, rules, inputSignature: order.curtain_package_pricing_signature };
}

async function validateCurtainPackageRooms(
  resolved: Awaited<ReturnType<typeof resolveCurtainPackage>>,
  rooms: OrderCreateInput["rooms"],
  persistedByWindow: Map<string, string[]> = new Map(),
): Promise<void> {
  if (!resolved.rules) return;
  if (resolved.inputSignature !== packagePricingSignature(resolved.rules)) {
    throw new Error("Package prices changed or the preview is not ready. Refresh the consultation and review its price before saving.");
  }
  if (rooms.some((room) => room.windows.some((window) => window.variant === "blind" && !window.blind_type_id))) {
    throw new Error("Select a blind type for every blind window before finalising a package order");
  }
  const ids = [...new Set(rooms.flatMap((room) => room.windows.flatMap((window) => window.variant === "regular" ? [window.day_curtain_type_id, window.night_curtain_type_id] : []).filter((id): id is string => !!id)))];
  const [series, addons] = await Promise.all([
    ids.length ? db.selectFrom("curtain_types as type").innerJoin("curtain_series as series", "series.id", "type.series_id")
      .select(["type.id", "series.name", "series.cost_rmb_cents", "series.sale_sgd_cents"]).where("type.id", "in", ids).execute() : [],
    loadAddonCatalogue(),
  ]);
  const price = (id?: string) => {
    if (!id) return null;
    const item = series.find((row) => row.id === id);
    if (!item) throw new Error("Selected curtain series no longer exists");
    return { label: item.name, costRmbCents: item.cost_rmb_cents, saleSgdCents: item.sale_sgd_cents };
  };
  const result = resolveCurtainPackageQuote(rooms.flatMap((room, roomIndex) => room.windows.map((window) => ({
    roomIndex, roomLabel: room.label, covering: window.variant === "blind" ? "blind" as const : "curtain" as const,
    widthCm: window.width_cm ?? null, dayPrice: window.variant === "regular" ? price(window.day_curtain_type_id) : null, nightPrice: window.variant === "regular" ? price(window.night_curtain_type_id) : null,
    comboPriceSgdCents: window.variant === "regular" && window.combo_id ? 0 : null,
    addons: toCalcAddons(resolveWindowAddons(window.variant === "blind" ? "blind" : "curtain", window.width_cm ?? null,
      window.addon_ids ?? [], persistedByWindow.get((window as { id?: string }).id ?? "") ?? [], addons)),
  }))), resolved.rules);
  if (result.issues.length) throw new Error(result.issues.join("; "));
}

// The shared write-path obligations (quote baseline, photo sweep, order meta
// columns, numbering placeholders) live in order-shared.ts so the curtain and
// mesh actions can't drift apart on them.

/** The window fields the add-on resolver needs, on any of the three shapes. */
type AddonWindowLike = {
  variant: "regular" | "blind";
  width_cm?: number | null;
  addon_ids?: string[];
};

/**
 * Re-resolve a window's add-ons server-side and write them.
 *
 * The browser's locked checkboxes are UX; this is the guarantee. A payload that
 * omits extra_shipping on a 230cm blind gets it charged anyway, one that
 * attaches a curtain add-on to a blind has it dropped, and one that attaches an
 * archived or unpriced add-on to a NEW window has it dropped too — persistedIds
 * is empty there, and only the database may say an add-on was already present.
 */
async function writeWindowAddons(
  trx: Transaction<DB>,
  windowId: string,
  win: AddonWindowLike,
  catalogue: AddonRule[],
  persistedIds: readonly string[],
): Promise<void> {
  const resolved = resolveWindowAddons(
    win.variant === "blind" ? "blind" : "curtain",
    win.width_cm ?? null,
    win.addon_ids ?? [],
    persistedIds,
    catalogue,
  );
  const ids = selectedAddonIds(resolved);

  await trx
    .deleteFrom("window_addons")
    .where("window_id", "=", windowId)
    .execute();
  if (ids.length > 0) {
    await trx
      .insertInto("window_addons")
      .values(ids.map((addon_id) => ({ window_id: windowId, addon_id })))
      .execute();
  }
}

export async function createOrder(input: unknown): Promise<never> {
  const session = await requireRole(["consultant", "admin"]);
  const parsed: OrderCreateInput = orderCreateSchema.parse(input);
  const packageSnapshot = await resolveCurtainPackage(parsed.order);
  await validateCurtainPackageRooms(packageSnapshot, parsed.rooms);
  // Read once, outside the transaction: every window resolves against the same
  // catalogue, so one order cannot be half-quoted under an edit made mid-save.
  const addonCatalogue = await loadAddonCatalogue();

  const orderId = await db.transaction().execute(async (trx) => {
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
        consultant_id: session.user.id,
        appointment_id: customer.appointmentId,
        lead_id: customer.leadId,
        property_type: parsed.order.property_type ?? null,
        development: parsed.order.development ?? null,
        site_address: parsed.order.site_address?.trim() || null,
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
        ...packageSnapshot.values,
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
        // A blind is one covering and is valid in EVERY room type. Only
        // curtains are constrained: a toilet takes a blind and nothing else.
        const matchesShape = isToilet
          ? win.variant === "blind"
          : win.variant === "regular" || win.variant === "blind";
        if (!matchesShape) {
          throw new Error(
            `Window variant '${win.variant}' does not match room type '${room.type}'`,
          );
        }

        const insertedWin = await trx
          .insertInto("windows")
          .values({ room_id: insertedRoom.id, ...windowValues(win, w) })
          .returning("id")
          .executeTakeFirstOrThrow();
        // No persisted state on a create — the payload cannot claim any.
        await writeWindowAddons(trx, insertedWin.id, win, addonCatalogue, []);
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

  await stampQuoteBaseline(orderId);

  redirect(`/orders/${orderId}`);
}

export async function updateOrder(
  orderId: string,
  input: unknown,
  returnRoomIds = false,
): Promise<{ roomIds: string[] }> {
  if (typeof orderId !== "string" || orderId.length === 0) {
    throw new Error("Invalid order id");
  }

  const session = await requireRole(["consultant", "admin"]);
  const parsed: OrderEditInput = orderEditSchema.parse(input);
  const existingPackage = await db
    .selectFrom("orders")
    .select([
      "curtain_package_id", "curtain_package_name", "curtain_package_type",
      "curtain_package_tier", "curtain_package_sale_sgd_cents",
      "curtain_package_rules",
      "is_draft",
    ])
    .where("id", "=", orderId)
    .executeTakeFirst();
  const packageSnapshot = await resolveCurtainPackage(
    parsed.order,
    existingPackage?.is_draft ? null : existingPackage?.curtain_package_id,
    existingPackage?.is_draft ? null : existingPackage?.curtain_package_rules,
  );
  const packageValues = packageSnapshot.values;

  const addonCatalogue = await loadAddonCatalogue();
  // What the join table holds RIGHT NOW, straight from the database. This — not
  // the payload — is what lets an archived or since-zeroed add-on stay on a
  // window it already sits on, so an edit does not silently drop a real charge.
  const persistedByWindow = await loadWindowAddonIds(
    (
      await db
        .selectFrom("windows")
        .innerJoin("rooms", "rooms.id", "windows.room_id")
        .select("windows.id as id")
        .where("rooms.order_id", "=", orderId)
        .execute()
    ).map((r) => r.id),
  );

  const orphanStoragePaths: string[] = [];
  await validateCurtainPackageRooms(packageSnapshot, parsed.rooms, persistedByWindow);

  const roomIds = await db.transaction().execute(async (trx) => {
    const order = await trx
      .selectFrom("orders")
      .select([
        "id", "customer_id", "consultant_id", "current_status", "is_draft",
        "appointment_id", "lead_id",
      ])
      .where("id", "=", orderId)
      .forUpdate()
      .executeTakeFirst();
    if (!order) throw new Error("Order not found");

    const isOwner = order.consultant_id === session.user.id;
    const isAdmin = session.profile.role === "admin";
    if (!isOwner && !isAdmin) {
      throw new Error("Forbidden");
    }

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

    await trx
      .updateTable("orders")
      .set({
        property_type: parsed.order.property_type ?? null,
        development: parsed.order.development ?? null,
        site_address: parsed.order.site_address?.trim() || null,
        unit_type: parsed.order.unit_type ?? null,
        move_in_date: parsed.order.move_in_date ?? null,
        price_quoted_cents: parsed.order.price_quoted_cents,
        deposit_cents: parsed.order.deposit_cents,
        freight_mode: parsed.order.freight_mode,
        channel: parsed.order.channel,
        extra_install_sgd_cents: parsed.order.extra_install_cents,
        discount_bps: parsed.order.discount_bps,
        promo_label: parsed.order.promo_label ?? null,
        ...packageValues,
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
        // A blind is one covering and is valid in EVERY room type. Only
        // curtains are constrained: a toilet takes a blind and nothing else.
        const matchesShape = isToilet
          ? win.variant === "blind"
          : win.variant === "regular" || win.variant === "blind";
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
          await writeWindowAddons(
            trx,
            win.id,
            win,
            addonCatalogue,
            persistedByWindow.get(win.id) ?? [],
          );
        } else {
          const insertedWin = await trx
            .insertInto("windows")
            .values({ room_id: roomId, ...values })
            .returning("id")
            .executeTakeFirstOrThrow();
          keepWindowIds.push(insertedWin.id);
          await writeWindowAddons(trx, insertedWin.id, win, addonCatalogue, []);
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

  await sweepPhotoStorage(orphanStoragePaths, "updateOrder");

  await stampQuoteBaseline(orderId);

  revalidatePath(`/orders/${orderId}`);
  revalidatePath(`/orders/${orderId}/edit`);
  revalidatePath("/orders");

  if (returnRoomIds !== true) redirect(`/orders/${orderId}`);
  return { roomIds };
}

export async function moveOrderRoom(input: {
  orderId: string;
  roomId: string;
  direction: "up" | "down";
}): Promise<void> {
  const orderId = typeof input?.orderId === "string" ? input.orderId : "";
  const roomId = typeof input?.roomId === "string" ? input.roomId : "";
  const direction = input?.direction;
  if (!orderId || !roomId || (direction !== "up" && direction !== "down")) {
    throw new Error("Invalid room move");
  }

  const session = await requireRole(["consultant", "admin"]);

  await db.transaction().execute(async (trx) => {
    // Lock the parent so two quick reorder requests cannot interleave and leave
    // duplicate or skipped positions.
    const order = await trx
      .selectFrom("orders")
      .select(["id", "consultant_id", "current_status"])
      .where("id", "=", orderId)
      .forUpdate()
      .executeTakeFirst();
    if (!order) throw new Error("Order not found");

    const isOwner = order.consultant_id === session.user.id;
    const isAdmin = session.profile.role === "admin";
    if (!isOwner && !isAdmin) throw new Error("Forbidden");
    if (isLocked(order.current_status)) {
      throw new Error(
        "This order is locked — room order cannot change after it has been sent to the vendor.",
      );
    }

    const rooms = await trx
      .selectFrom("rooms")
      .select("id")
      .where("order_id", "=", orderId)
      .orderBy("position", "asc")
      .orderBy("id", "asc")
      .execute();
    const currentIndex = rooms.findIndex((room) => room.id === roomId);
    if (currentIndex < 0) throw new Error("Room not found");

    const targetIndex = currentIndex + (direction === "up" ? -1 : 1);
    if (targetIndex < 0 || targetIndex >= rooms.length) return;

    [rooms[currentIndex], rooms[targetIndex]] = [
      rooms[targetIndex],
      rooms[currentIndex],
    ];
    for (let position = 0; position < rooms.length; position++) {
      await trx
        .updateTable("rooms")
        .set({ position })
        .where("id", "=", rooms[position].id)
        .where("order_id", "=", orderId)
        .execute();
    }
  });

  revalidatePath(`/orders/${orderId}`);
  revalidatePath(`/orders/${orderId}/edit`);
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
    .select(["id", "consultant_id", "current_status"])
    .where("id", "=", orderId)
    .executeTakeFirst();
  if (!order) throw new Error("Order not found");

  const isOwner = order.consultant_id === session.user.id;
  const isAdmin = session.profile.role === "admin";
  if (!isOwner && !isAdmin) throw new Error("Forbidden");

  // Re-quoting rewrites price_quoted_cents on an order the customer has
  // already paid a deposit against and whose goods are in production.
  if (isLocked(order.current_status)) {
    throw new Error(
      "This order is locked — it has been sent to the vendor. Ask an admin to amend the manufacturing measurements instead.",
    );
  }

  const quote = await computeOrderQuote(orderId);
  if (!quote) throw new Error("Nothing priced to re-quote");
  if (quote.pricingIssues?.length) throw new Error(quote.pricingIssues.join("; "));

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

// Accept the calculator's current result as the new comparison baseline while
// preserving the price already agreed with the customer. This clears a stale
// pricing warning without changing the quote, deposit, balance or order status.
export async function acknowledgeQuoteDrift(orderId: string): Promise<void> {
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
  if (!quote) throw new Error("Nothing priced to acknowledge");
  if (quote.pricingIssues?.length) throw new Error(quote.pricingIssues.join("; "));

  await db
    .updateTable("orders")
    .set({ price_calc_at_quote_cents: quote.discountedSaleSgdCents })
    .where("id", "=", orderId)
    .execute();

  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/orders");
}

export async function amendOrderPayment(input: {
  orderId: string;
  quotedCents: number;
  depositCents: number;
}): Promise<void> {
  const session = await requireRole(["admin"]);
  const orderId = typeof input?.orderId === "string" ? input.orderId : "";
  const quotedCents = Number(input?.quotedCents);
  const depositCents = Number(input?.depositCents);

  if (!orderId) throw new Error("Invalid order id");
  for (const [label, cents] of [
    ["Quoted amount", quotedCents],
    ["Deposit paid", depositCents],
  ] as const) {
    if (!Number.isInteger(cents) || cents < 0 || cents > 100_000_000) {
      throw new Error(`${label} must be a valid amount`);
    }
  }
  if (depositCents > quotedCents) {
    throw new Error("Deposit paid cannot be more than the quoted amount");
  }

  // The app deliberately supports a local-auth bypass, so there may be no
  // browser JWT. Invoke through the trusted server database connection; the
  // function independently verifies the supplied actor is an active admin.
  await sql`
    select public.amend_order_payment(
      ${orderId}::uuid,
      ${quotedCents}::integer,
      ${depositCents}::integer,
      ${session.user.id}::uuid
    )
  `.execute(db);

  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/orders");
}

export async function deleteOrder(input: {
  orderId: string;
  confirmIdentifier: string;
}): Promise<never> {
  await requireRole(["admin"]);
  if (
    typeof input?.orderId !== "string" ||
    typeof input?.confirmIdentifier !== "string"
  ) {
    throw new Error("Invalid input");
  }

  const order = await db
    .selectFrom("orders")
    .select(["id", "display_id", "order_reference"])
    .where("id", "=", input.orderId)
    .executeTakeFirst();
  if (!order) throw new Error("Order not found");

  const orderIdentifier = primaryOrderIdentifier(
    order.order_reference,
    order.display_id,
  );
  if (input.confirmIdentifier.trim() !== orderIdentifier) {
    throw new Error(`Type ${orderIdentifier} exactly to confirm deletion`);
  }

  // Capture every photo's storage_path before the cascade fires so we can
  // sweep the bucket after the DB commits.
  const photos = await db
    .selectFrom("room_photos")
    .innerJoin("rooms", "rooms.id", "room_photos.room_id")
    .select("room_photos.storage_path as storage_path")
    .where("rooms.order_id", "=", order.id)
    .execute();

  const completionPhotos = await db
    .selectFrom("order_completion_photos")
    .select("storage_path")
    .where("order_id", "=", order.id)
    .execute();
  const purchaseOrders = await db
    .selectFrom("manufacture_pos")
    .select("storage_path")
    .where("order_id", "=", order.id)
    .execute();
  const arrangement = await db
    .selectFrom("fulfilment_arrangements")
    .select(["id", "google_event_id"])
    .where("order_id", "=", order.id)
    .executeTakeFirst();

  // A late-stage order may own a live installation booking. Verify Calendar
  // access before starting cleanup; the try/catch below also covers a partial
  // cleanup when both a legacy and deterministic event id exist.
  if (arrangement) {
    if (!isCalendarConfigured()) {
      throw new Error(
        "This order has an installation booking that may have a Calendar event. Restore Google Calendar access before deleting it.",
      );
    }
  }

  try {
    if (arrangement) {
      const eventIds = new Set([
        ...(arrangement.google_event_id ? [arrangement.google_event_id] : []),
        fulfilmentCalendarEventId(arrangement.id),
      ]);
      for (const eventId of eventIds) await deleteEvent(eventId);
    }

    await db.transaction().execute(async (trx) => {
      if (arrangement) {
        await trx
          .deleteFrom("fulfilment_arrangement_events")
          .where("arrangement_id", "=", arrangement.id)
          .execute();
        await trx
          .deleteFrom("fulfilment_arrangements")
          .where("id", "=", arrangement.id)
          .execute();
      }
      // The database lock still rejects ad-hoc deletion of sent orders. This
      // transaction-local opt-in is reached only after the admin role check,
      // typed order-number confirmation and external Calendar cleanup above.
      await sql`select set_config('app.allow_locked_order_delete', 'on', true)`.execute(trx);

      // Cascades: orders → rooms/windows/photos, completion photos, generated PO
      // rows and status events. The customer remains for cross-order history.
      await trx.deleteFrom("orders").where("id", "=", order.id).execute();
    });
  } catch (error) {
    // Google was changed first so a failed database delete must restore the
    // still-live order's event. The normal sync path recreates a missing event
    // and records a retryable failure if Google is unavailable.
    if (arrangement) {
      const recovery = await syncFulfilmentArrangement(arrangement.id);
      if (!recovery.ok) {
        console.error(
          "installation calendar recovery failed during deleteOrder:",
          recovery.error,
        );
      }
    }
    throw error;
  }

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

  if (completionPhotos.length > 0) {
    const { error } = await adminClient()
      .storage.from(COMPLETION_PHOTO_BUCKET)
      .remove(completionPhotos.map((photo) => photo.storage_path));
    if (error) console.error("completion-photo storage sweep failed during deleteOrder:", error.message);
  }

  if (purchaseOrders.length > 0) {
    const { error } = await adminClient()
      .storage.from("manufacture-pos")
      .remove(purchaseOrders.map((po) => po.storage_path));
    if (error) console.error("purchase-order storage sweep failed during deleteOrder:", error.message);
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
  const packageSnapshot = await resolveCurtainPackage(parsed.order);
  const addonCatalogue = await loadAddonCatalogue();

  const orderId = await db.transaction().execute(async (trx) => {
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
        consultant_id: session.user.id,
        appointment_id: customer.appointmentId,
        lead_id: customer.leadId,
        property_type: parsed.order.property_type ?? null,
        development: parsed.order.development ?? null,
        site_address: parsed.order.site_address?.trim() || null,
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
        ...packageSnapshot.values,
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
            win.variant === "blind" || isToilet
              ? ("blind" as const)
              : ("regular" as const),
        };
        const insertedWin = await trx
          .insertInto("windows")
          .values({ room_id: insertedRoom.id, ...windowValues(shaped, w) })
          .returning("id")
          .executeTakeFirstOrThrow();
        // Drafts are relaxed about COMPLETENESS, never about correctness of
        // charge — so they resolve like any other write path.
        await writeWindowAddons(trx, insertedWin.id, shaped, addonCatalogue, []);
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

// The vendor/delivery-facing identifier (Phase 13A). Deliberately NOT
// status-gated: it's a paperwork identifier rather than a manufacturing
// input, and a vendor may ask for a renumber mid-production even after the
// order locks at sent_to_vendor.
export async function setOrderReference(input: unknown): Promise<void> {
  await requireRole(["ops", "admin"]);
  const parsed = orderReferenceSchema.parse(input);

  try {
    await db
      .updateTable("orders")
      .set({ order_reference: parsed.reference })
      .where("id", "=", parsed.orderId)
      .execute();
  } catch (e) {
    // 23505 = unique_violation on orders_order_reference_key (partial unique
    // index over non-null order_reference values).
    if (typeof e === "object" && e !== null && "code" in e && e.code === "23505") {
      throw new Error("That order reference is already used by another order.");
    }
    // Everything else goes through userMessage so a raw Postgres string never
    // reaches a toast — the same guard every other action in this file uses.
    throw new Error(userMessage(e, "Could not save the order reference."));
  }

  revalidatePath(`/orders/${parsed.orderId}`);
  revalidatePath(`/orders/${parsed.orderId}/manufacture`);
  revalidatePath("/orders");
}
