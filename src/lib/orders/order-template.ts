import "server-only";

import { db } from "@/lib/db/kysely";
import { signRoomPhotoUrls } from "@/lib/db/photos";
import { loadWindowAddonIds } from "@/lib/db/window-addons";
import type { UploaderPhoto } from "@/components/orders/photo-uploader";
import type { MeshOrderEditInput } from "@/lib/validation/mesh";
import { isToiletRoom, type OrderEditInput } from "@/lib/validation/order";

type TemplateResult<T> = {
  sourceDisplayId: string;
  defaults: T;
  roomPhotos: Record<string, UploaderPhoto[]>;
};

async function loadTemplatePhotos(roomIds: string[]) {
  if (roomIds.length === 0) return {};
  const photos = await db
    .selectFrom("room_photos")
    .select(["id", "room_id", "storage_path", "original_name"])
    .where("room_id", "in", roomIds)
    .orderBy("position", "asc")
    .orderBy("created_at", "asc")
    .execute();
  const signed = await signRoomPhotoUrls(photos.map((photo) => photo.storage_path));
  const byRoom: Record<string, UploaderPhoto[]> = {};
  for (const photo of photos) {
    const signedUrl = signed.get(photo.storage_path);
    if (!signedUrl) continue;
    byRoom[photo.room_id] = [
      ...(byRoom[photo.room_id] ?? []),
      { id: photo.id, signedUrl, originalName: photo.original_name },
    ];
  }
  return byRoom;
}

async function loadTemplateOrder(
  customerId: string,
  productLine: "curtain" | "mesh",
) {
  return db
    .selectFrom("orders")
    .innerJoin("customers", "customers.id", "orders.customer_id")
    .select([
      "orders.id",
      "orders.display_id",
      "orders.property_type",
      "orders.development",
      "orders.site_address",
      "orders.unit_type",
      "orders.move_in_date",
      "orders.general_notes",
      "orders.freight_mode",
      "orders.channel",
      "orders.extra_install_sgd_cents",
      "customers.name as customer_name",
      "customers.mobile as customer_mobile",
      "customers.email as customer_email",
    ])
    .where("orders.customer_id", "=", customerId)
    .where("orders.product_line", "=", productLine)
    .where("orders.is_draft", "=", false)
    .orderBy("orders.updated_at", "desc")
    .executeTakeFirst();
}

function toDateInput(value: Date | string | null): string {
  if (!value) return "";
  return new Date(value).toISOString().slice(0, 10);
}

function orderDefaults(
  order: NonNullable<Awaited<ReturnType<typeof loadTemplateOrder>>>,
): OrderEditInput["order"] {
  return {
    property_type: order.property_type ?? undefined,
    development: order.development ?? "",
    site_address: order.site_address ?? "",
    unit_type: order.unit_type ?? "",
    move_in_date: toDateInput(order.move_in_date),
    // A repeat quote is a new commercial decision. Let the live calculator
    // derive its current price and deposit instead of copying old money.
    price_quoted_cents: 0,
    deposit_cents: 0,
    general_notes: order.general_notes ?? "",
    is_draft: false,
    freight_mode: order.freight_mode,
    channel: order.channel,
    extra_install_cents: order.extra_install_sgd_cents,
    discount_bps: 0,
    promo_label: undefined,
    curtain_package_id: "",
    curtain_package_tier: "essential",
    curtain_package_single_layer: "night",
  };
}

export async function loadCurtainOrderTemplate(
  customerId: string,
): Promise<TemplateResult<OrderEditInput> | undefined> {
  const order = await loadTemplateOrder(customerId, "curtain");
  if (!order) return undefined;

  const rooms = await db
    .selectFrom("rooms")
    .select(["id", "type", "label"])
    .where("order_id", "=", order.id)
    .orderBy("position", "asc")
    .execute();
  const roomIds = rooms.map((room) => room.id);
  const windows = roomIds.length === 0
    ? []
    : await db
        .selectFrom("windows")
        .select([
          "id",
          "room_id",
          "width_cm",
          "height_cm",
          "notes",
          "side_installation",
          "overlap_tracks_attachment",
          "day_curtain_type_id",
          "night_curtain_type_id",
          "blind_type_id",
          "draw",
          "split_left_cm",
          "split_right_cm",
          "combo_id",
        ])
        .where("room_id", "in", roomIds)
        .orderBy("position", "asc")
        .execute();
  const windowsByRoom = new Map<string, typeof windows>();
  for (const window of windows) {
    windowsByRoom.set(window.room_id, [
      ...(windowsByRoom.get(window.room_id) ?? []),
      window,
    ]);
  }
  const addonIdsByWindow = await loadWindowAddonIds(
    windows.map((window) => window.id),
  );
  const roomPhotos = await loadTemplatePhotos(roomIds);

  return {
    sourceDisplayId: order.display_id,
    roomPhotos,
    defaults: {
      customer: {
        name: order.customer_name,
        mobile: order.customer_mobile,
        email: order.customer_email ?? "",
      },
      order: orderDefaults(order),
      rooms: rooms.map((room, roomIndex) => ({
        template_room_id: room.id,
        type: room.type,
        label: room.label,
        position: roomIndex,
        windows: (windowsByRoom.get(room.id) ?? []).map((window, windowIndex) => {
          if (window.blind_type_id || isToiletRoom(room.type)) {
            return {
              variant: "blind" as const,
              position: windowIndex,
              blind_type_id: window.blind_type_id ?? "",
              draw: window.draw === "Double" ? undefined : (window.draw ?? undefined),
              width_cm: window.width_cm ?? null,
              height_cm: window.height_cm ?? null,
              notes: window.notes ?? "",
              side_installation: window.side_installation,
              addon_ids: addonIdsByWindow.get(window.id) ?? [],
            };
          }
          return {
            variant: "regular" as const,
            position: windowIndex,
            day_curtain_type_id: window.day_curtain_type_id ?? "",
            night_curtain_type_id: window.night_curtain_type_id ?? "",
            draw: window.draw ?? "Double",
            split_left_cm: window.split_left_cm ?? null,
            split_right_cm: window.split_right_cm ?? null,
            width_cm: window.width_cm ?? null,
            height_cm: window.height_cm ?? null,
            notes: window.notes ?? "",
            side_installation: window.side_installation,
            overlap_tracks_attachment: window.overlap_tracks_attachment,
            combo_id: window.combo_id ?? "",
            addon_ids: addonIdsByWindow.get(window.id) ?? [],
          };
        }),
      })),
    },
  };
}

export async function loadMeshOrderTemplate(
  customerId: string,
): Promise<TemplateResult<MeshOrderEditInput> | undefined> {
  const order = await loadTemplateOrder(customerId, "mesh");
  if (!order) return undefined;

  const rooms = await db
    .selectFrom("rooms")
    .select(["id", "type", "label"])
    .where("order_id", "=", order.id)
    .orderBy("position", "asc")
    .execute();
  const roomIds = rooms.map((room) => room.id);
  const panels = roomIds.length === 0
    ? []
    : await db
        .selectFrom("mesh_panels")
        .select([
          "room_id",
          "category_id",
          "colour_id",
          "width_cm",
          "height_cm",
          "has_window",
          "has_inset_horizontal",
          "has_inset_vertical",
          "draw",
          "split_left_cm",
          "split_right_cm",
          "notes",
        ])
        .where("room_id", "in", roomIds)
        .orderBy("position", "asc")
        .execute();
  const panelsByRoom = new Map<string, typeof panels>();
  for (const panel of panels) {
    panelsByRoom.set(panel.room_id, [
      ...(panelsByRoom.get(panel.room_id) ?? []),
      panel,
    ]);
  }
  const roomPhotos = await loadTemplatePhotos(roomIds);

  return {
    sourceDisplayId: order.display_id,
    roomPhotos,
    defaults: {
      customer: {
        name: order.customer_name,
        mobile: order.customer_mobile,
        email: order.customer_email ?? "",
      },
      order: orderDefaults(order),
      rooms: rooms.map((room, roomIndex) => ({
        template_room_id: room.id,
        type: room.type,
        label: room.label,
        position: roomIndex,
        panels: (panelsByRoom.get(room.id) ?? []).map((panel, panelIndex) => ({
          position: panelIndex,
          category_id: panel.category_id ?? "",
          colour_id: panel.colour_id ?? "",
          width_cm: panel.width_cm ?? null,
          height_cm: panel.height_cm ?? null,
          has_window: panel.has_window,
          has_inset_horizontal: panel.has_inset_horizontal,
          has_inset_vertical: panel.has_inset_vertical,
          draw: panel.draw ?? undefined,
          split_left_cm: panel.split_left_cm ?? null,
          split_right_cm: panel.split_right_cm ?? null,
          notes: panel.notes ?? "",
        })),
      })),
    },
  };
}
