import "server-only";

// The single reader of "what is this order actually going to manufacture".
//
// Both the reconciliation screen and confirmManufactureMeasurements go through
// here. If they each built their own query they could disagree about what an
// order contains — the screen showing five panels while the action writes four
// — and the difference would only ever surface at a vendor's cutting table.

import type { Kysely, Transaction } from "kysely";

import type { CurtainHeightPreference } from "@/lib/curtain-height-preference";
import { formatCurtainOptionLabel } from "@/lib/curtain-types/series";
import { db } from "@/lib/db/kysely";
import type { DB, DrawDirection } from "@/lib/db/schema";
import type { AllowanceBook, AllowanceLine } from "@/lib/manufacture/allowance";
import { resolveTrackOptions } from "@/lib/po/track-options";
import { ALLOWANCE_LINES } from "@/lib/validation/manufacture";

// Matches the precedent in lib/actions/order-shared.ts: callers pass either the
// pooled db or an open transaction, so the confirm action can read the same
// snapshot it is about to write into.
type Executor = Transaction<DB> | Kysely<DB>;

export type ManufactureLine = {
  /** Stable id for the row: the window id or the mesh panel id. */
  lineId: string;
  kind: "window" | "mesh_panel";
  roomLabel: string;
  roomPosition: number;
  position: number;
  /** The consultant's window label — names problems; null falls back to position. */
  windowName?: string | null;
  /** A rail with no covering — confirms on width alone (allowance.ts). */
  trackOnly?: boolean;
  /** Which allowance applies. A window carrying a blind resolves to "blind". */
  line: AllowanceLine;
  /** What the piece is, for display: series/type labels, verbatim. */
  description: string | null;
  widthCm: number | null;
  heightCm: number | null;
  /** Optional measured allocation for an off-centre double draw. */
  splitLeftCm?: number | null;
  splitRightCm?: number | null;
  /**
   * windows.draw — authoritative. The confirm action decides the bead shape
   * (single count, or left/right per leaf) from this, not from the payload.
   */
  draw: DrawDirection | null;
  /**
   * Whether the window carries the s_fold add-on, resolved through the track
   * registry like the PO loader. Always false on a mesh panel or a blind —
   * only a curtain can take S-fold runners.
   */
  sFold: boolean;
  /**
   * The window's saved curtain drop, shared by its day and night curtains.
   * When set it REPLACES the configured curtain height allowance (see
   * effectiveAllowance). Null on a legacy window, a blind, a track-only
   * rail, or a mesh panel — those keep the configured allowance.
   */
  curtainHeightPreference: CurtainHeightPreference | null;
};

// "Series #index · Page — Label", or null when nothing is selected. Same helper
// the order detail page uses, so the two screens name a piece identically.
function labelOf(
  series: string | null,
  index: number | null,
  page: string | null,
  label: string | null,
): string | null {
  return label ? formatCurtainOptionLabel({ series, index, page, label }) : null;
}

function joinParts(parts: (string | null)[]): string | null {
  const kept = parts.filter((p): p is string => !!p);
  return kept.length > 0 ? kept.join(" · ") : null;
}

export async function loadManufactureLines(
  orderId: string,
  executor: Executor = db,
): Promise<ManufactureLine[]> {
  const order = await executor
    .selectFrom("orders")
    .select("product_line")
    .where("id", "=", orderId)
    .executeTakeFirst();
  if (!order) return [];

  // A curtain order has no mesh panels and a mesh order has no windows, so only
  // one of the two tables is ever worth querying.
  if (order.product_line === "mesh") {
    const panels = await executor
      .selectFrom("mesh_panels")
      .innerJoin("rooms", "rooms.id", "mesh_panels.room_id")
      // Joined by id regardless of is_active, matching the detail page, so an
      // archived category or colour still names the piece instead of blanking.
      .leftJoin("mesh_categories as mc", "mc.id", "mesh_panels.category_id")
      .leftJoin("mesh_colours as mcol", "mcol.id", "mesh_panels.colour_id")
      .select([
        "mesh_panels.id as id",
        "mesh_panels.position as position",
        "mesh_panels.width_cm as width_cm",
        "mesh_panels.height_cm as height_cm",
        "rooms.label as room_label",
        "rooms.position as room_position",
        "mc.name as category_name",
        "mcol.name as colour_name",
      ])
      .where("rooms.order_id", "=", orderId)
      .orderBy("rooms.position", "asc")
      .orderBy("mesh_panels.position", "asc")
      .execute();

    return panels.map((p) => ({
      lineId: p.id,
      kind: "mesh_panel" as const,
      roomLabel: p.room_label,
      roomPosition: p.room_position,
      position: p.position,
      line: "mesh" as const,
      // Catalogue names verbatim — vendor codes are the customer's language.
      description: joinParts([p.category_name, p.colour_name]),
      widthCm: p.width_cm,
      heightCm: p.height_cm,
      splitLeftCm: null,
      splitRightCm: null,
      draw: null,
      sFold: false,
      curtainHeightPreference: null,
    }));
  }

  const windows = await executor
    .selectFrom("windows")
    .innerJoin("rooms", "rooms.id", "windows.room_id")
    .leftJoin("curtain_types as day_ct", "day_ct.id", "windows.day_curtain_type_id")
    .leftJoin(
      "curtain_types as night_ct",
      "night_ct.id",
      "windows.night_curtain_type_id",
    )
    .leftJoin("curtain_series as day_cs", "day_cs.id", "day_ct.series_id")
    .leftJoin("curtain_series as night_cs", "night_cs.id", "night_ct.series_id")
    .leftJoin("curtain_types as blind_ct", "blind_ct.id", "windows.blind_type_id")
    .leftJoin("curtain_series as blind_cs", "blind_cs.id", "blind_ct.series_id")
    .select([
      "windows.id as id",
      "windows.position as position",
      "windows.label as window_label",
      "windows.track_only as track_only",
      "windows.track_kind as track_kind",
      "windows.width_cm as width_cm",
      "windows.height_cm as height_cm",
      "windows.split_left_cm as split_left_cm",
      "windows.split_right_cm as split_right_cm",
      "windows.draw as draw",
      "windows.curtain_height_preference as curtain_height_preference",
      "rooms.label as room_label",
      "rooms.position as room_position",
      "day_ct.label as day_curtain_label",
      "day_ct.series_index as day_curtain_index",
      "day_ct.page as day_curtain_page",
      "day_cs.name as day_curtain_series",
      "night_ct.label as night_curtain_label",
      "night_ct.series_index as night_curtain_index",
      "night_ct.page as night_curtain_page",
      "night_cs.name as night_curtain_series",
      "windows.blind_type_id as blind_type_id",
      "blind_ct.label as blind_label",
      "blind_ct.series_index as blind_index",
      "blind_ct.page as blind_page",
      "blind_cs.name as blind_series",
    ])
    .where("rooms.order_id", "=", orderId)
    .orderBy("rooms.position", "asc")
    .orderBy("windows.position", "asc")
    .execute();

  // The persisted add-on joins are the order's source of truth for whether a
  // window takes S-fold runners — the same rule the PO loader follows. One
  // query for the whole order, keyed per window, so a large order does not
  // turn into a query per row.
  const addonRows = await executor
    .selectFrom("window_addons")
    .innerJoin("windows", "windows.id", "window_addons.window_id")
    .innerJoin("rooms", "rooms.id", "windows.room_id")
    .innerJoin("pricing_addons", "pricing_addons.id", "window_addons.addon_id")
    .select([
      "window_addons.window_id as window_id",
      "pricing_addons.key as key",
    ])
    .where("rooms.order_id", "=", orderId)
    .execute();
  const addonKeysByWindow = new Map<string, string[]>();
  for (const r of addonRows) {
    addonKeysByWindow.set(r.window_id, [
      ...(addonKeysByWindow.get(r.window_id) ?? []),
      r.key,
    ]);
  }

  return windows.map((w) => {
    // A window is ONE covering — day/night curtains or a blind, never a mix —
    // so this is an either/or, not a priority list.
    const isBlind = w.blind_type_id != null;
    const description = w.track_only
      ? `Track only — ${w.track_kind === "double" ? "double" : "single"} track`
      : isBlind
        ? labelOf(w.blind_series, w.blind_index, w.blind_page, w.blind_label)
        : joinParts([
          prefixed(
            "Day",
            labelOf(
              w.day_curtain_series,
              w.day_curtain_index,
              w.day_curtain_page,
              w.day_curtain_label,
            ),
          ),
          prefixed(
            "Night",
            labelOf(
              w.night_curtain_series,
              w.night_curtain_index,
              w.night_curtain_page,
              w.night_curtain_label,
            ),
          ),
        ]);

    return {
      lineId: w.id,
      kind: "window" as const,
      roomLabel: w.room_label,
      roomPosition: w.room_position,
      position: w.position,
      windowName: w.window_label,
      trackOnly: w.track_only,
      // A track-only rail confirms its production width through the same
      // allowance/override workflow a curtain uses — the confirmed number is
      // what the track order cuts to.
      line: isBlind ? ("blind" as const) : ("curtain" as const),
      description,
      widthCm: w.width_cm,
      heightCm: w.height_cm,
      splitLeftCm: w.split_left_cm,
      splitRightCm: w.split_right_cm,
      draw: w.draw,
      // A blind has no rail to space runners on: only a curtain window can be
      // S-fold, matching the PO loader's per-covering flag. A track-only
      // window can carry the s_fold rail fitting, but it has no curtain to
      // count beads for.
      sFold:
        !isBlind &&
        !w.track_only &&
        resolveTrackOptions({
          addonKeys: addonKeysByWindow.get(w.id) ?? [],
        }).s_fold,
      // Neither a blind nor a bare rail carries a drop — the column is nulled
      // for both — but belt-and-suspenders keeps a stray value from quietly
      // replacing the blind allowance or putting a curtain deduction on a
      // window with no fabric.
      curtainHeightPreference:
        isBlind || w.track_only
          ? null
          : (w.curtain_height_preference as CurtainHeightPreference | null),
    };
  });
}

// Day and night curtains are two pieces on one window, so the label alone is
// ambiguous. The catalogue label itself is untouched.
function prefixed(role: string, label: string | null): string | null {
  return label ? `${role}: ${label}` : null;
}

export async function loadAllowanceBook(
  executor: Executor = db,
): Promise<AllowanceBook> {
  const rows = await executor
    .selectFrom("manufacture_allowances")
    .select(["product_line", "width_delta_cm", "height_delta_cm"])
    .execute();

  // Start every line unconfigured, so a row that has gone missing reads as
  // "nobody has set this" rather than silently defaulting to zero.
  const book = Object.fromEntries(
    ALLOWANCE_LINES.map((line) => [line, null]),
  ) as AllowanceBook;

  for (const row of rows) {
    const line = row.product_line as AllowanceLine;
    if (!ALLOWANCE_LINES.includes(line)) continue;
    // Null means UNCONFIGURED; 0/0 is a real answer ("manufacture at the
    // measured size") and must survive as an allowance, not collapse to null.
    if (row.width_delta_cm == null || row.height_delta_cm == null) continue;
    book[line] = {
      widthDeltaCm: row.width_delta_cm,
      heightDeltaCm: row.height_delta_cm,
    };
  }

  return book;
}
