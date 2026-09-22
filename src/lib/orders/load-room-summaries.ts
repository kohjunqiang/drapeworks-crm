import "server-only";

import type { MeshPanelSummary } from "@/components/orders/mesh-room-summary-card";
import type { PhotoTile } from "@/components/orders/photo-strip";
import { formatCurtainOptionLabel } from "@/lib/curtain-types/series";
import { signCurtainTypePhotoUrls } from "@/lib/db/curtain-types";
import { db } from "@/lib/db/kysely";
import {
  loadActiveMeshSystemBands,
  loadActiveMeshSystemSpecs,
} from "@/lib/db/mesh-catalogue";
import { signRoomPhotoUrls } from "@/lib/db/photos";
import type { FulfilmentStatus, ProductLine } from "@/lib/db/schema";
import {
  formatMmAsCm,
  resolveMeshDrop,
  resolveMeshSystem,
  resolveMeshTrack,
} from "@/lib/orders/mesh-system";
import { panelBillableArea } from "@/lib/pricing/mesh-calculator";
import { loadMeshPriceBook } from "@/lib/pricing/order-quote";
import { statusIndex } from "@/lib/status-flow";

/**
 * The "Rooms & measurements" assembly behind the order detail page: rooms,
 * their windows or mesh panels, the frozen installation sizes and the signed
 * room photos. The order page and the public installer page share this loader
 * so the installer sees exactly what the team sees.
 *
 * The raw joined rows (windows, meshPanels, addonsByWindow, meshBook) come
 * back too — the order page still needs them for the fabric-selection notes
 * and the mesh area breakdown.
 */
export async function loadRoomSummaries(order: {
  id: string;
  product_line: ProductLine;
  current_status: FulfilmentStatus;
}) {
  const rooms = await db
    .selectFrom("rooms")
    .select(["id", "type", "label", "position"])
    .where("order_id", "=", order.id)
    .orderBy("position", "asc")
    .execute();

  const roomIds = rooms.map((r) => r.id);

  const isMesh = order.product_line === "mesh";

  const windows =
    roomIds.length === 0 || isMesh
      ? []
      : await db
          .selectFrom("windows")
          .leftJoin(
            "curtain_types as day_ct",
            "day_ct.id",
            "windows.day_curtain_type_id",
          )
          .leftJoin(
            "curtain_types as night_ct",
            "night_ct.id",
            "windows.night_curtain_type_id",
          )
          .leftJoin("curtain_series as day_cs", "day_cs.id", "day_ct.series_id")
          .leftJoin(
            "curtain_series as night_cs",
            "night_cs.id",
            "night_ct.series_id",
          )
          .leftJoin(
            "curtain_types as blind_ct",
            "blind_ct.id",
            "windows.blind_type_id",
          )
          .leftJoin(
            "curtain_series as blind_cs",
            "blind_cs.id",
            "blind_ct.series_id",
          )
          .leftJoin("pricing_combos as combo", "combo.id", "windows.combo_id")
          .select([
            "windows.id as id",
            "windows.room_id as room_id",
            "windows.position as position",
            "windows.width_cm as width_cm",
            "windows.height_cm as height_cm",
            "windows.notes as notes",
            "windows.side_installation as side_installation",
            "windows.overlap_tracks_attachment as overlap_tracks_attachment",
            "windows.day_track_required",
            "windows.night_track_required",
            "windows.draw as draw",
            "windows.split_left_cm as split_left_cm",
            "windows.split_right_cm as split_right_cm",
            "combo.name as combo_label",
            "day_ct.label as day_curtain_label",
            "day_ct.photo_path as day_curtain_photo_path",
            "day_ct.series_index as day_curtain_index",
            "day_ct.page as day_curtain_page",
            "day_cs.name as day_curtain_series",
            "night_ct.label as night_curtain_label",
            "night_ct.photo_path as night_curtain_photo_path",
            "night_ct.series_index as night_curtain_index",
            "night_ct.page as night_curtain_page",
            "night_cs.name as night_curtain_series",
            "windows.blind_type_id as blind_type_id",
            "blind_ct.label as blind_label",
            "blind_ct.photo_path as blind_photo_path",
            "blind_ct.series_index as blind_index",
            "blind_ct.page as blind_page",
            "blind_cs.name as blind_series",
          ])
          .where("windows.room_id", "in", roomIds)
          .orderBy("windows.position", "asc")
          .execute();

  // Mesh panels for a mesh order. Joined to the catalogue by id regardless of
  // is_active, so an archived category or colour still renders on an existing
  // order rather than showing a blank.
  const meshPanels =
    roomIds.length === 0 || !isMesh
      ? []
      : await db
          .selectFrom("mesh_panels")
          .leftJoin(
            "mesh_categories as mc",
            "mc.id",
            "mesh_panels.category_id",
          )
          .leftJoin("mesh_colours as mcol", "mcol.id", "mesh_panels.colour_id")
          .select([
            "mesh_panels.id as id",
            "mesh_panels.room_id as room_id",
            "mesh_panels.position as position",
            "mesh_panels.width_cm as width_cm",
            "mesh_panels.height_cm as height_cm",
            "mesh_panels.has_window as has_window",
            "mesh_panels.has_inset_horizontal as has_inset_horizontal",
            "mesh_panels.has_inset_vertical as has_inset_vertical",
            "mesh_panels.category_id as category_id",
            "mesh_panels.colour_id as colour_id",
            "mesh_panels.draw as draw",
            "mesh_panels.split_left_cm as split_left_cm",
            "mesh_panels.split_right_cm as split_right_cm",
            "mesh_panels.notes as notes",
            "mc.name as category_name",
            "mcol.name as colour_name",
          ])
          .where("mesh_panels.room_id", "in", roomIds)
          .orderBy("mesh_panels.position", "asc")
          .execute();

  // Once the PO measurements have been confirmed, keep the original site
  // measurement and the frozen installation size together on the order page.
  // The latter must come from the stored snapshot, never be recalculated from
  // today's allowance settings.
  const frozenMeasurements =
    statusIndex(order.current_status) < statusIndex("po_ready")
      ? []
      : await db
          .selectFrom("manufacture_measurements")
          .select([
            "window_id",
            "mesh_panel_id",
            "mfg_width_cm",
            "mfg_height_cm",
          ])
          .where("order_id", "=", order.id)
          .execute();
  const installationByLine = new Map(
    frozenMeasurements.flatMap((measurement) => {
      const lineId = measurement.window_id ?? measurement.mesh_panel_id;
      return lineId
        ? [[lineId, measurement] as const]
        : [];
    }),
  );

  // The track system is derived, never stored (§5.9), so it is resolved here
  // for the factory sheet rather than read off the row.
  const [systemBands, systemSpecs, meshBook] = isMesh
    ? await Promise.all([
        loadActiveMeshSystemBands(),
        loadActiveMeshSystemSpecs(),
        loadMeshPriceBook(),
      ])
    : [[], [], null];

  const panelsByRoom = new Map<string, MeshPanelSummary[]>();
  for (const p of meshPanels) {
    const list = panelsByRoom.get(p.room_id) ?? [];
    const key = {
      widthCm: p.width_cm,
      heightCm: p.height_cm,
      draw: p.draw ?? undefined,
      hasInsetHorizontal: p.has_inset_horizontal,
      hasInsetVertical: p.has_inset_vertical,
    };
    const resolved = resolveMeshSystem(key, systemBands);
    const track = resolveMeshTrack(key, systemBands, systemSpecs);
    const drop = resolveMeshDrop(key, systemBands, systemSpecs);
    // Only set when a minimum actually floors the panel, so the column shows
    // the uplift rather than repeating the measured area.
    const billable = meshBook
      ? panelBillableArea(
          {
            categoryId: p.category_id,
            colourId: p.colour_id,
            widthCm: p.width_cm,
            heightCm: p.height_cm,
            draw: p.draw ?? null,
          },
          meshBook,
        )
      : null;
    list.push({
      ...p,
      installation_width_cm:
        installationByLine.get(p.id)?.mfg_width_cm ?? null,
      installation_height_cm:
        installationByLine.get(p.id)?.mfg_height_cm ?? null,
      system: resolved.status === "resolved" ? resolved.system : null,
      trackCm:
        track.status === "resolved" ? formatMmAsCm(track.trackMm) : null,
      dropCm: drop.status === "resolved" ? formatMmAsCm(drop.dropMm) : null,
      billedSqm:
        billable && billable.billableCm2 > billable.actualCm2
          ? (billable.billableCm2 / 10_000).toFixed(2)
          : null,
    });
    panelsByRoom.set(p.room_id, list);
  }

  // Sign every referenced curtain-type hero photo in one batch.
  const curtainPhotoPaths = windows
    .flatMap((w) => [
      w.day_curtain_photo_path,
      w.night_curtain_photo_path,
    ])
    .filter((p): p is string => !!p);
  const curtainPhotoUrls = await signCurtainTypePhotoUrls(curtainPhotoPaths);
  const urlFor = (path: string | null) =>
    path ? (curtainPhotoUrls.get(path) ?? null) : null;

  // A window's add-ons, by name, for the summary card. Read from the join as
  // written — the same rows the quote priced. Key and auto_rule also feed the
  // fabric-selection notes, which list manual add-ons only.
  const addonsByWindow = new Map<
    string,
    { key: string; autoRule: string; label: string }[]
  >();
  for (const r of roomIds.length === 0 || isMesh
    ? []
    : await db
        .selectFrom("window_addons")
        .innerJoin("windows", "windows.id", "window_addons.window_id")
        .innerJoin(
          "pricing_addons",
          "pricing_addons.id",
          "window_addons.addon_id",
        )
        .select([
          "window_addons.window_id as window_id",
          "pricing_addons.key as key",
          "pricing_addons.auto_rule as auto_rule",
          "pricing_addons.label as label",
        ])
        .where("windows.room_id", "in", roomIds)
        .orderBy("pricing_addons.label", "asc")
        .execute()) {
    addonsByWindow.set(r.window_id, [
      ...(addonsByWindow.get(r.window_id) ?? []),
      { key: r.key, autoRule: r.auto_rule, label: r.label },
    ]);
  }
  const addonLabelsByWindow = new Map<string, string[]>(
    [...addonsByWindow].map(([windowId, addons]) => [
      windowId,
      addons.map((addon) => addon.label),
    ]),
  );

  // Build the "Series #index · Page — Label" display string per curtain, or
  // null when the window has no curtain type selected.
  const labelOf = (
    series: string | null,
    index: number | null,
    page: string | null,
    label: string | null,
  ) =>
    label
      ? formatCurtainOptionLabel({ series, index, page, label })
      : null;

  const windowSummaries = windows.map((w) => ({
    position: w.position,
    width_cm: w.width_cm,
    height_cm: w.height_cm,
    installation_width_cm:
      installationByLine.get(w.id)?.mfg_width_cm ?? null,
    installation_height_cm:
      installationByLine.get(w.id)?.mfg_height_cm ?? null,
    notes: w.notes,
    side_installation: w.side_installation,
    overlap_tracks_attachment: w.overlap_tracks_attachment,
    day_track_required: w.day_track_required,
    night_track_required: w.night_track_required,
    draw: w.draw,
    split_left_cm: w.split_left_cm,
    split_right_cm: w.split_right_cm,
    addon_labels: addonLabelsByWindow.get(w.id) ?? [],
    combo_label: w.combo_label,
    room_id: w.room_id,
    day_curtain_label: labelOf(
      w.day_curtain_series,
      w.day_curtain_index,
      w.day_curtain_page,
      w.day_curtain_label,
    ),
    day_curtain_photo_url: urlFor(w.day_curtain_photo_path),
    night_curtain_label: labelOf(
      w.night_curtain_series,
      w.night_curtain_index,
      w.night_curtain_page,
      w.night_curtain_label,
    ),
    night_curtain_photo_url: urlFor(w.night_curtain_photo_path),
    is_blind: w.blind_type_id != null,
    blind_label: labelOf(
      w.blind_series,
      w.blind_index,
      w.blind_page,
      w.blind_label,
    ),
    blind_photo_url: urlFor(w.blind_photo_path),
  }));

  const windowsByRoom = new Map<string, typeof windowSummaries>();
  for (const w of windowSummaries) {
    const list = windowsByRoom.get(w.room_id) ?? [];
    list.push(w);
    windowsByRoom.set(w.room_id, list);
  }

  const photos =
    roomIds.length === 0
      ? []
      : await db
          .selectFrom("room_photos")
          .select([
            "id",
            "room_id",
            "storage_path",
            "original_name",
            "position",
            "created_at",
          ])
          .where("room_id", "in", roomIds)
          .orderBy("position", "asc")
          .orderBy("created_at", "asc")
          .execute();

  const signed = await signRoomPhotoUrls(photos.map((p) => p.storage_path));

  const photosByRoom = new Map<string, PhotoTile[]>();
  for (const p of photos) {
    const url = signed.get(p.storage_path);
    if (!url) continue;
    const list = photosByRoom.get(p.room_id) ?? [];
    list.push({
      id: p.id,
      signedUrl: url,
      originalName: p.original_name,
    });
    photosByRoom.set(p.room_id, list);
  }

  return {
    rooms,
    isMesh,
    windows,
    meshPanels,
    meshBook,
    addonsByWindow,
    windowsByRoom,
    panelsByRoom,
    photosByRoom,
    hasInstallationSizes: frozenMeasurements.length > 0,
  };
}
