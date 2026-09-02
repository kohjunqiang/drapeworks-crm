import "server-only";

import { db } from "@/lib/db/kysely";

import {
  buildInstallationSummary,
  type InstallationOpening,
} from "./installation-summary";

export async function loadInstallationSummary(
  orderId: string,
  scheduledAt: Date | string,
  durationMins: number,
  address: string,
): Promise<{ text: string; customerName: string; displayId: string }> {
  const order = await db
    .selectFrom("orders")
    .innerJoin("customers", "customers.id", "orders.customer_id")
    .select([
      "orders.id",
      "orders.display_id",
      "orders.product_line",
      "customers.name as customer_name",
      "customers.mobile as customer_mobile",
    ])
    .where("orders.id", "=", orderId)
    .executeTakeFirstOrThrow();

  const rooms = await db
    .selectFrom("rooms")
    .select(["id", "label", "position"])
    .where("order_id", "=", orderId)
    .orderBy("position", "asc")
    .execute();
  const roomIds = rooms.map((room) => room.id);

  const frozen = await db
    .selectFrom("manufacture_measurements")
    .select(["window_id", "mesh_panel_id", "mfg_width_cm", "mfg_height_cm"])
    .where("order_id", "=", orderId)
    .execute();
  const frozenByLine = new Map(
    frozen.flatMap((measurement) => {
      const id = measurement.window_id ?? measurement.mesh_panel_id;
      return id ? [[id, measurement] as const] : [];
    }),
  );

  const openings: InstallationOpening[] = [];
  if (roomIds.length > 0 && order.product_line !== "mesh") {
    const windows = await db
      .selectFrom("windows")
      .select([
        "id",
        "room_id",
        "position",
        "width_cm",
        "height_cm",
        "notes",
        "side_installation",
        "draw",
        "day_curtain_type_id",
        "night_curtain_type_id",
        "blind_type_id",
      ])
      .where("room_id", "in", roomIds)
      .orderBy("position", "asc")
      .execute();
    const addonRows = windows.length
      ? await db
          .selectFrom("window_addons")
          .innerJoin(
            "pricing_addons",
            "pricing_addons.id",
            "window_addons.addon_id",
          )
          .select(["window_addons.window_id", "pricing_addons.label"])
          .where(
            "window_addons.window_id",
            "in",
            windows.map((window) => window.id),
          )
          .orderBy("pricing_addons.label", "asc")
          .execute()
      : [];
    const addonsByWindow = new Map<string, string[]>();
    for (const row of addonRows) {
      addonsByWindow.set(row.window_id, [
        ...(addonsByWindow.get(row.window_id) ?? []),
        row.label,
      ]);
    }
    for (const room of rooms) {
      const roomWindows = windows.filter((window) => window.room_id === room.id);
      for (let index = 0; index < roomWindows.length; index += 1) {
        const window = roomWindows[index];
        const size = frozenByLine.get(window.id);
        const layerCount = Number(Boolean(window.day_curtain_type_id)) + Number(Boolean(window.night_curtain_type_id));
        const covering: InstallationOpening["covering"] = window.blind_type_id
          ? "Blinds"
          : layerCount === 2
            ? "Double"
            : layerCount === 1
              ? "Single"
              : "Curtain";
        openings.push({
          roomLabel: room.label,
          openingNumber: index + 1,
          openingsInRoom: roomWindows.length,
          covering,
          widthCm: size?.mfg_width_cm ?? window.width_cm,
          heightCm: size?.mfg_height_cm ?? window.height_cm,
          draw: window.draw,
          addonLabels: addonsByWindow.get(window.id) ?? [],
          sideInstallation: window.side_installation,
          installationNote: window.notes,
        });
      }
    }
  }

  if (roomIds.length > 0 && order.product_line === "mesh") {
    const panels = await db
      .selectFrom("mesh_panels")
      .select(["id", "room_id", "position", "width_cm", "height_cm", "draw", "notes"])
      .where("room_id", "in", roomIds)
      .orderBy("position", "asc")
      .execute();
    for (const room of rooms) {
      const roomPanels = panels.filter((panel) => panel.room_id === room.id);
      for (let index = 0; index < roomPanels.length; index += 1) {
        const panel = roomPanels[index];
        const size = frozenByLine.get(panel.id);
        openings.push({
          roomLabel: room.label,
          openingNumber: index + 1,
          openingsInRoom: roomPanels.length,
          covering: "Mesh",
          widthCm: size?.mfg_width_cm ?? panel.width_cm,
          heightCm: size?.mfg_height_cm ?? panel.height_cm,
          draw: panel.draw,
          addonLabels: [],
          sideInstallation: false,
          installationNote: panel.notes,
        });
      }
    }
  }

  return {
    text: buildInstallationSummary({
      scheduledAt,
      durationMins,
      address,
      customerName: order.customer_name,
      customerMobile: order.customer_mobile,
      openings,
    }),
    customerName: order.customer_name,
    displayId: order.display_id,
  };
}
