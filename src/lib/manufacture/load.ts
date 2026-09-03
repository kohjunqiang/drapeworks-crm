import "server-only";

// The single reader of "what is this order actually going to manufacture".
//
// Both the reconciliation screen and confirmManufactureMeasurements go through
// here. If they each built their own query they could disagree about what an
// order contains — the screen showing five panels while the action writes four
// — and the difference would only ever surface at a vendor's cutting table.

import type { Kysely, Transaction } from "kysely";

import { formatCurtainOptionLabel } from "@/lib/curtain-types/series";
import { db } from "@/lib/db/kysely";
import type { DB } from "@/lib/db/schema";
import type { AllowanceBook, AllowanceLine } from "@/lib/manufacture/allowance";
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
  /** Which allowance applies. A window carrying a blind resolves to "blind". */
  line: AllowanceLine;
  /** What the piece is, for display: series/type labels, verbatim. */
  description: string | null;
  widthCm: number | null;
  heightCm: number | null;
  /** Optional measured allocation for an off-centre double draw. */
  splitLeftCm?: number | null;
  splitRightCm?: number | null;
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
      "windows.width_cm as width_cm",
      "windows.height_cm as height_cm",
      "windows.split_left_cm as split_left_cm",
      "windows.split_right_cm as split_right_cm",
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

  return windows.map((w) => {
    // A window is ONE covering — day/night curtains or a blind, never a mix —
    // so this is an either/or, not a priority list.
    const isBlind = w.blind_type_id != null;
    const description = isBlind
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
      line: isBlind ? ("blind" as const) : ("curtain" as const),
      description,
      widthCm: w.width_cm,
      heightCm: w.height_cm,
      splitLeftCm: w.split_left_cm,
      splitRightCm: w.split_right_cm,
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
