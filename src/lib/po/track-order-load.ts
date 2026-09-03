import "server-only";

// What goes on this order's rail order, read once.
//
// Same split as po/load.ts: this module is the world, track-order.ts is the
// arithmetic. It reads CONFIRMED MANUFACTURING widths, because that is where
// the rail's own allowance already lives: curtain is seeded at −2 cm and the
// reconciliation screen lets a human change it per window, which is the only
// place a bay window or a wall-to-wall run gets to say it needs something other
// than 2 cm. Taking windows.width_cm and deducting again here would apply the
// allowance twice, and every rail in the order would arrive short.

import { db } from "@/lib/db/kysely";

import type { TrackOrderLine } from "./track-order";

export type TrackOrderLoad = {
  lines: TrackOrderLine[];
  /** procurement_settings.track_note_cn — the standing instructions. */
  noteCn: string | null;
  /**
   * Windows that need a rail but have no confirmed manufacturing width, named.
   *
   * Left OUT of the lines and said out loud instead. A rail order is a cutting
   * instruction: a window quietly missing from it comes back as a site visit
   * with one curtain and nowhere to hang it. Guessing the width from the site
   * measurement would be worse — it would put a plausible number in a cutting
   * list that nobody has checked.
   */
  unmeasured: Array<{
    label: string;
    shipmentKind: TrackOrderLine["shipmentKind"];
    overlapTracksAttachment: boolean;
  }>;
};

export async function loadTrackOrder(orderId: string): Promise<TrackOrderLoad> {
  const [rows, settings, sFoldRows] = await Promise.all([
    db
      .selectFrom("windows")
      .innerJoin("rooms", "rooms.id", "windows.room_id")
      // Left, not inner: a window with no confirmed measurement still has to
      // reach the loop, so it can be named in `unmeasured` rather than vanish.
      // At most one row per window (mm_window_key), so this fans out nothing.
      .leftJoin(
        "manufacture_measurements",
        "manufacture_measurements.window_id",
        "windows.id",
      )
      .select([
        "windows.id as window_id",
        "windows.position as position",
        "manufacture_measurements.mfg_width_cm as mfg_width_cm",
        "windows.day_curtain_type_id as day_curtain_type_id",
        "windows.night_curtain_type_id as night_curtain_type_id",
        "windows.blind_type_id as blind_type_id",
        "windows.side_installation as side_installation",
        "windows.overlap_tracks_attachment as overlap_tracks_attachment",
        "rooms.label as room_label",
      ])
      .where("rooms.order_id", "=", orderId)
      .orderBy("rooms.position", "asc")
      .orderBy("windows.position", "asc")
      .execute(),
    db
      .selectFrom("procurement_settings")
      .select("track_note_cn")
      .where("singleton", "=", true)
      .executeTakeFirst(),
    db
      .selectFrom("window_addons")
      .innerJoin("pricing_addons", "pricing_addons.id", "window_addons.addon_id")
      .innerJoin("windows", "windows.id", "window_addons.window_id")
      .innerJoin("rooms", "rooms.id", "windows.room_id")
      .select("window_addons.window_id")
      .where("rooms.order_id", "=", orderId)
      .where("pricing_addons.key", "=", "s_fold")
      .execute(),
  ]);
  const sFoldWindowIds = new Set(sFoldRows.map((row) => row.window_id));

  const lines: TrackOrderLine[] = [];
  const unmeasured: TrackOrderLoad["unmeasured"] = [];

  for (const w of rows) {
    // A blind carries its own headrail, so it orders no track. A window with
    // nothing on it orders none either.
    if (w.blind_type_id) continue;
    const curtains = [
      w.day_curtain_type_id,
      w.night_curtain_type_id,
    ].filter(Boolean).length;
    if (curtains === 0) continue;

    // Positions are 0-based in the database and 1-based on every screen.
    const label = `${w.room_label} — Window ${w.position + 1}`;

    if (w.mfg_width_cm == null || w.mfg_width_cm <= 0) {
      unmeasured.push({
        label,
        shipmentKind: sFoldWindowIds.has(w.window_id)
          ? "s_fold_tracks"
          : "standard_tracks",
        overlapTracksAttachment: w.overlap_tracks_attachment,
      });
      continue;
    }

    lines.push({
      label,
      widthCm: w.mfg_width_cm,
      // Day + night is two runs of rail over one opening; a single curtain —
      // day only or night only — is one. A toilet window is a blind since
      // Phase 14, so it carries its own headrail and never reaches here.
      kind: curtains >= 2 ? "double" : "single",
      shipmentKind: sFoldWindowIds.has(w.window_id)
        ? "s_fold_tracks"
        : "standard_tracks",
      sideInstallation: w.side_installation,
      overlapTracksAttachment: w.overlap_tracks_attachment,
    });
  }

  return { lines, noteCn: settings?.track_note_cn ?? null, unmeasured };
}
