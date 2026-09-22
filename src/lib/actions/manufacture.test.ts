import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  requireRole: vi.fn(),
  revalidatePath: vi.fn(),
  loadManufactureLines: vi.fn(),
  loadAllowanceBook: vi.fn(),
  materializeShipmentManifest: vi.fn(),
  generateOrderPos: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth/require-role", () => ({
  requireRole: mocks.requireRole,
  requireSession: vi.fn(),
}));
vi.mock("@/lib/db/kysely", () => ({ db: { transaction: mocks.transaction } }));
vi.mock("@/lib/manufacture/load", () => ({
  loadManufactureLines: mocks.loadManufactureLines,
  loadAllowanceBook: mocks.loadAllowanceBook,
}));
vi.mock("@/lib/logistics/load", () => ({
  materializeShipmentManifest: mocks.materializeShipmentManifest,
}));
vi.mock("./procurement", () => ({ generateOrderPos: mocks.generateOrderPos }));

import type { ManufactureLine } from "@/lib/manufacture/load";
import { confirmManufactureMeasurements } from "./manufacture";

const orderId = "a31fd642-0fe2-4066-9762-880b0e023471";
const windowId1 = "11111111-1111-4111-8111-111111111111";
const windowId2 = "22222222-2222-4222-8222-222222222222";
const panelId = "33333333-3333-4333-8333-333333333333";

type Where = [string, string, unknown];

type RecordedConflict = {
  column?: string;
  predicate?: Where;
  set?: Record<string, unknown>;
};

type RecordedInsert = {
  kind: "insert";
  table: string;
  values: unknown;
  conflict: RecordedConflict;
};

type RecordedUpdate = {
  kind: "update";
  table: string;
  set: Record<string, unknown>;
  wheres: Where[];
};

type Write = RecordedInsert | RecordedUpdate;

function setupOrder(currentStatus = "deposit_received") {
  const writes: Write[] = [];
  const trx = {
    selectFrom: (table: string) => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        where: () => chain,
        forUpdate: () => chain,
        executeTakeFirst: async () =>
          table === "orders" ? { current_status: currentStatus } : undefined,
        execute: async () => [],
      };
      return chain;
    },
    insertInto: (table: string) => ({
      values: (values: unknown) => {
        const record: RecordedInsert = {
          kind: "insert",
          table,
          values,
          conflict: {},
        };
        writes.push(record);
        const doUpdateSet = (update: unknown) => {
          record.conflict.set =
            typeof update === "function"
              ? update({ ref: (name: string) => `ref:${name}` })
              : update;
          return { execute: async () => [] };
        };
        return {
          execute: async () => [],
          onConflict: (callback: (conflict: unknown) => unknown) => {
            callback({
              column: (column: string) => {
                record.conflict.column = column;
                return {
                  where: (lhs: string, op: string, rhs: unknown) => {
                    record.conflict.predicate = [lhs, op, rhs];
                    return { doUpdateSet };
                  },
                  doUpdateSet,
                };
              },
            });
            return { execute: async () => [] };
          },
        };
      },
    }),
    updateTable: (table: string) => {
      const record: RecordedUpdate = {
        kind: "update",
        table,
        set: {},
        wheres: [],
      };
      writes.push(record);
      return {
        set: (set: Record<string, unknown>) => {
          record.set = set;
          const chain = {
            where: (lhs: string, op: string, rhs: unknown) => {
              record.wheres.push([lhs, op, rhs]);
              return chain;
            },
            execute: async () => [],
          };
          return chain;
        },
      };
    },
  };
  mocks.transaction.mockReturnValue({
    execute: async (callback: (tx: typeof trx) => unknown) => callback(trx),
  });
  return { writes, trx };
}

function windowLine(lineId: string, position = 0): ManufactureLine {
  return {
    lineId,
    kind: "window",
    roomLabel: "Living",
    roomPosition: 0,
    position,
    line: "curtain",
    description: null,
    widthCm: 200,
    heightCm: 250,
    splitLeftCm: null,
    splitRightCm: null,
  };
}

function meshLine(lineId: string, position = 0): ManufactureLine {
  return {
    lineId,
    kind: "mesh_panel",
    roomLabel: "Balcony",
    roomPosition: 0,
    position,
    line: "mesh",
    description: null,
    widthCm: 150,
    heightCm: 240,
    splitLeftCm: null,
    splitRightCm: null,
  };
}

const allowanceBook = {
  curtain: { widthDeltaCm: 10, heightDeltaCm: -5 },
  blind: { widthDeltaCm: 2, heightDeltaCm: 2 },
  mesh: { widthDeltaCm: 0, heightDeltaCm: 0 },
};

function payloadFor(lines: ManufactureLine[]) {
  return {
    orderId,
    lines: lines.map((line) => ({ lineId: line.lineId, kind: line.kind })),
  };
}

const measurementInserts = (writes: Write[]) =>
  writes.filter(
    (w): w is RecordedInsert =>
      w.kind === "insert" && w.table === "manufacture_measurements",
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireRole.mockResolvedValue({ user: { id: "ops-user" } });
  mocks.loadAllowanceBook.mockResolvedValue(allowanceBook);
});

describe("confirmManufactureMeasurements re-confirmation upsert", () => {
  it("writes window rows as an upsert keyed on window_id and still records the po_ready event", async () => {
    const lines = [windowLine(windowId1, 0), windowLine(windowId2, 1)];
    mocks.loadManufactureLines.mockResolvedValue(lines);
    const { writes } = setupOrder();

    await confirmManufactureMeasurements(payloadFor(lines));

    const inserts = measurementInserts(writes);
    expect(inserts).toHaveLength(1);
    const insert = inserts[0];
    expect(insert.conflict.column).toBe("window_id");
    expect(insert.conflict.predicate).toEqual(["window_id", "is not", null]);

    // Every measurement column is refreshed from the incoming row.
    const set = insert.conflict.set ?? {};
    for (const column of [
      "order_id",
      "source_width_cm",
      "source_height_cm",
      "width_delta_cm",
      "height_delta_cm",
      "mfg_width_cm",
      "mfg_height_cm",
      "mfg_split_left_cm",
      "mfg_split_right_cm",
      "is_overridden",
      "override_reason",
      "confirmed_by",
    ]) {
      expect(set[column]).toBe(`ref:excluded.${column}`);
    }
    // confirmed_at's default only fires on insert; the update must set it.
    expect(set.confirmed_at).toBeDefined();

    const rows = insert.values as Record<string, unknown>[];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      order_id: orderId,
      window_id: windowId1,
      mesh_panel_id: null,
      mfg_width_cm: 210,
      mfg_height_cm: 245,
      confirmed_by: "ops-user",
    });

    const statusEvent = writes.find(
      (w) => w.kind === "insert" && w.table === "order_status_events",
    );
    expect(statusEvent).toBeDefined();
    expect(
      (statusEvent as RecordedInsert).values,
    ).toMatchObject({ order_id: orderId, status: "po_ready" });
  });

  it("writes a mesh-panel row with the mesh_panel_id conflict target", async () => {
    const lines = [meshLine(panelId)];
    mocks.loadManufactureLines.mockResolvedValue(lines);
    const { writes } = setupOrder();

    await confirmManufactureMeasurements(payloadFor(lines));

    const inserts = measurementInserts(writes);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].conflict.column).toBe("mesh_panel_id");
    expect(inserts[0].conflict.predicate).toEqual([
      "mesh_panel_id",
      "is not",
      null,
    ]);
    const rows = inserts[0].values as Record<string, unknown>[];
    expect(rows[0]).toMatchObject({
      window_id: null,
      mesh_panel_id: panelId,
    });
  });

  it("issues no mesh statement for a window-only order", async () => {
    const lines = [windowLine(windowId1)];
    mocks.loadManufactureLines.mockResolvedValue(lines);
    const { writes } = setupOrder();

    await confirmManufactureMeasurements(payloadFor(lines));

    const inserts = measurementInserts(writes);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].conflict.column).toBe("window_id");
  });

  it("supersedes the order's current POs in the same transaction, before the status event", async () => {
    const lines = [windowLine(windowId1)];
    mocks.loadManufactureLines.mockResolvedValue(lines);
    const { writes } = setupOrder();

    await confirmManufactureMeasurements(payloadFor(lines));

    const poUpdate = writes.find(
      (w): w is RecordedUpdate =>
        w.kind === "update" && w.table === "manufacture_pos",
    );
    expect(poUpdate).toBeDefined();
    expect(poUpdate!.set.superseded_at).toBeInstanceOf(Date);
    expect(poUpdate!.wheres).toEqual([
      ["order_id", "=", orderId],
      ["superseded_at", "is", null],
    ]);

    const supersedeIndex = writes.indexOf(poUpdate!);
    const eventIndex = writes.findIndex(
      (w) => w.kind === "insert" && w.table === "order_status_events",
    );
    expect(eventIndex).toBeGreaterThan(-1);
    expect(supersedeIndex).toBeLessThan(eventIndex);
  });
});

describe("confirmManufactureMeasurements refusals", () => {
  it("rejects an order that is not at deposit_received and writes nothing", async () => {
    const lines = [windowLine(windowId1)];
    mocks.loadManufactureLines.mockResolvedValue(lines);
    const { writes } = setupOrder("po_ready");

    await expect(
      confirmManufactureMeasurements(payloadFor(lines)),
    ).rejects.toThrow(/can only be confirmed from "Deposit Received"/);
    expect(writes).toEqual([]);
  });

  it("rejects a payload whose line set does not match the order", async () => {
    const lines = [windowLine(windowId1)];
    mocks.loadManufactureLines.mockResolvedValue(lines);
    const { writes } = setupOrder();

    await expect(
      confirmManufactureMeasurements({
        orderId,
        lines: [
          { lineId: windowId1, kind: "window" },
          { lineId: windowId2, kind: "window" },
        ],
      }),
    ).rejects.toThrow(/changed since the page was loaded/);
    expect(writes).toEqual([]);
  });

  it("guards with requireRole ops/admin", async () => {
    const lines = [windowLine(windowId1)];
    mocks.loadManufactureLines.mockResolvedValue(lines);
    setupOrder();

    await confirmManufactureMeasurements(payloadFor(lines));

    expect(mocks.requireRole).toHaveBeenCalledWith(["ops", "admin"]);
  });
});
