import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/window-addons", () => ({ loadWindowCalcAddons: async () => new Map() }));
const state = vi.hoisted(() => ({
  rows: {} as Record<string, Record<string, unknown>[]>,
  queries: [] as { table: string; columns: unknown[][]; filters: unknown[][]; ordering: unknown[][]; joins: unknown[][] }[],
}));
vi.mock("@/lib/db/kysely", () => ({ db: {
  selectFrom(table: string) {
    const query = { table, columns: [] as unknown[][], filters: [] as unknown[][], ordering: [] as unknown[][], joins: [] as unknown[][] };
    state.queries.push(query);
    const chain = {
      innerJoin: (...args: unknown[]) => { query.joins.push(args); return chain; },
      leftJoin: (...args: unknown[]) => { query.joins.push(args); return chain; },
      select: (...args: unknown[]) => { query.columns.push(args); return chain; },
      selectAll: () => chain,
      where: (...args: unknown[]) => { query.filters.push(args); return chain; },
      orderBy: (...args: unknown[]) => { query.ordering.push(args); return chain; },
      execute: async () => state.rows[table] ?? [],
      executeTakeFirst: async () => state.rows[table]?.[0],
    };
    return chain;
  },
} }));

import { loadPoInput } from "./load";
import { buildPos } from "./build";

beforeEach(() => {
  state.queries = [];
  state.rows = {
    orders: [{ order_reference: "QA-ROOMS", current_status: "po_ready", product_line: "curtain", freight_mode: "sea" }],
    procurement_settings: [{ company_name: "Synthetic QA" }],
    pricing_assumptions: [{ style_multiplier: 20000 }],
    // Saved labels deliberately run against position: the empty room claims
    // Bedroom 2 while the occupied one, added second, is Bedroom 1.
    rooms: [
      { id: "empty", type: "Bedroom", position: 0, label: "Bedroom 2" },
      { id: "occupied", type: "Bedroom", position: 1, label: "Bedroom 1" },
    ],
    room_type_labels: [{ room_type: "Bedroom", name_cn: "次卧", code: "BR" }],
    vendors: [{ id: "vendor", name: "QA Vendor", internal_ref: "QA" }],
    windows: [{ id: "window", position: 0, room_id: "occupied", room_label: "Bedroom 1",
      room_type: "Bedroom", room_position: 1, draw: "Double", day_label: "QA Fabric",
      day_vendor_id: "vendor", mfg_width_cm: 274, mfg_height_cm: 255 }],
  };
});

describe("loadPoInput room roster", () => {
  it("loads all order rooms with their labels and builds from the saved numbers", async () => {
    const loaded = await loadPoInput("order-qa", new Date("2026-10-18T00:00:00Z"));
    expect(loaded.problems).toEqual([]);
    expect(loaded.input?.rooms).toEqual(state.rows.rooms);
    expect(loaded.input?.lines).toHaveLength(1);
    expect(state.queries.find((q) => q.table === "rooms")).toEqual({
      table: "rooms", columns: [[["id", "type", "position", "label"]]],
      filters: [["order_id", "=", "order-qa"]],
      ordering: [["position", "asc"]], joins: [],
    });
    const built = buildPos(loaded.input!);
    expect(built.problems).toEqual([]);
    // Position would number this room 2; the saved label keeps it BR1.
    expect(built.pos[0].tables[0].rows[0]).toMatchObject({
      room: "次卧 1 BR1", widthM: "2.74", heightM: "2.55", derived: "5.48",
    });
  });

  it("creates no fabric PO row for a track-only window", async () => {
    // A rail with no covering: it must not reach the fabric vendor — the
    // track order handles it (see track-order-load.test.ts).
    state.rows.windows.push({
      id: "rail", position: 1, room_id: "occupied", room_label: "Bedroom 1",
      room_type: "Bedroom", room_position: 1, track_only: true,
      track_kind: "double", window_label: "Balcony", mfg_width_cm: 298,
      mfg_height_cm: 0,
    });
    const loaded = await loadPoInput("order-qa", new Date("2026-10-18T00:00:00Z"));
    // Exactly one covering survives — the curtain, identified by the fields a
    // PoLine actually carries. No second row: the rail never becomes fabric.
    expect(loaded.input?.lines).toEqual([
      expect.objectContaining({
        roomId: "occupied",
        position: 0,
        kind: "curtain",
        fabricLabel: "QA Fabric",
      }),
    ]);
  });
});
