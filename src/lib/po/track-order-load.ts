import "server-only";

// What goes on this order's rail order, read once.
//
// Same split as po/load.ts: this module is the world, track-order.ts is the
// arithmetic. It reads MEASURED widths, deliberately — a rail is cut to the
// opening it is screwed above, not to the panel a vendor cuts, so the
// manufacturing allowance has nothing to say here. That is the same rule the
// calculator prices the rail on.

import { db } from "@/lib/db/kysely";

import type { TrackOrderLine } from "./track-order";

export type TrackOrderLoad = {
  lines: TrackOrderLine[];
  /** procurement_settings.track_note_cn — the standing instructions. */
  noteCn: string | null;
  /**
   * Windows that need a rail but have no width recorded, named.
   *
   * Left OUT of the lines and said out loud instead. A rail order is a cutting
   * instruction: a window quietly missing from it comes back as a site visit
   * with one curtain and nowhere to hang it.
   */
  unmeasured: string[];
};

export async function loadTrackOrder(orderId: string): Promise<TrackOrderLoad> {
  const [rows, settings] = await Promise.all([
    db
      .selectFrom("windows")
      .innerJoin("rooms", "rooms.id", "windows.room_id")
      .select([
        "windows.position as position",
        "windows.width_cm as width_cm",
        "windows.day_curtain_type_id as day_curtain_type_id",
        "windows.night_curtain_type_id as night_curtain_type_id",
        "windows.curtain_type_id as curtain_type_id",
        "windows.blind_type_id as blind_type_id",
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
  ]);

  const lines: TrackOrderLine[] = [];
  const unmeasured: string[] = [];

  for (const w of rows) {
    // A blind carries its own headrail, so it orders no track. A window with
    // nothing on it orders none either.
    if (w.blind_type_id) continue;
    const curtains = [
      w.day_curtain_type_id,
      w.night_curtain_type_id,
      w.curtain_type_id,
    ].filter(Boolean).length;
    if (curtains === 0) continue;

    // Positions are 0-based in the database and 1-based on every screen.
    const label = `${w.room_label} — Window ${w.position + 1}`;

    if (w.width_cm == null || w.width_cm <= 0) {
      unmeasured.push(label);
      continue;
    }

    lines.push({
      label,
      widthCm: w.width_cm,
      // Day + night is two runs of rail over one opening; a single curtain —
      // day only, night only, or the one on a toilet window — is one.
      kind: curtains >= 2 ? "double" : "single",
    });
  }

  return { lines, noteCn: settings?.track_note_cn ?? null, unmeasured };
}
