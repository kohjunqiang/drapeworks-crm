import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const mocks = vi.hoisted(() => {
  type R = Record<string, unknown>;
  const state = { datasets: {} as Record<string, R[]> };

  function matches(row: R, col: string, op: string, val: unknown): boolean {
    const v = row[col];
    if (op === "=") return v === val;
    if (op === "in") return Array.isArray(val) && val.includes(v);
    if (op === "is") return val === null ? v === null || v === undefined : v !== null && v !== undefined;
    return true;
  }

  function compare(a: unknown, b: unknown): number {
    if (a === b) return 0;
    if (a === null || a === undefined) return -1;
    if (b === null || b === undefined) return 1;
    const an = a instanceof Date ? a.getTime() : (a as number | string);
    const bn = b instanceof Date ? b.getTime() : (b as number | string);
    return an < bn ? -1 : 1;
  }

  interface FakeSelect {
    innerJoin: (...args: unknown[]) => FakeSelect;
    leftJoin: (...args: unknown[]) => FakeSelect;
    select: (...args: unknown[]) => FakeSelect;
    distinctOn: (col: string | string[]) => FakeSelect;
    orderBy: (col: string, dir?: "asc" | "desc") => FakeSelect;
    where: (col: unknown, op?: unknown, val?: unknown) => FakeSelect;
    execute: () => Promise<R[]>;
    executeTakeFirst: () => Promise<R | undefined>;
    executeTakeFirstOrThrow: () => Promise<R>;
  }

  function makeSelect(rows: R[]): FakeSelect {
    const filters: { col: string; op: string; val: unknown }[] = [];
    const sorts: { col: string; dir: "asc" | "desc" }[] = [];
    let distinct: string[] = [];

    function applyAll(): R[] {
      let result = rows.filter((row) =>
        filters.every((f) => matches(row, f.col, f.op, f.val)),
      );
      for (const s of [...sorts].reverse()) {
        result = [...result].sort(
          (a, b) => compare(a[s.col], b[s.col]) * (s.dir === "desc" ? -1 : 1),
        );
      }
      if (distinct.length > 0) {
        const seen = new Set<string>();
        result = result.filter((row) => {
          const key = distinct.map((c) => String(row[c])).join("");
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      }
      return result;
    }

    const chain: FakeSelect = {
      innerJoin: () => chain,
      leftJoin: () => chain,
      select: () => chain,
      distinctOn: (col) => {
        distinct = Array.isArray(col) ? col : [col];
        return chain;
      },
      orderBy: (col, dir = "asc") => {
        sorts.push({ col, dir });
        return chain;
      },
      where: (col, op, val) => {
        if (typeof col === "string") {
          filters.push({ col, op: op as string, val });
        }
        return chain;
      },
      execute: async () => applyAll(),
      executeTakeFirst: async () => applyAll()[0],
      executeTakeFirstOrThrow: async () => {
        const row = applyAll()[0];
        if (!row) throw new Error("no result row");
        return row;
      },
    };
    return chain;
  }

  return { state, makeSelect };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/kysely", () => ({
  db: {
    selectFrom: (table: string) =>
      mocks.makeSelect(mocks.state.datasets[table] ?? []),
  },
}));
vi.mock("@/lib/db/photos", () => ({
  signRoomPhotoUrls: vi.fn(async () => new Map()),
  signWindowPhotoUrls: vi.fn(async () => new Map()),
}));
vi.mock("@/lib/db/window-addons", () => ({
  loadWindowAddonIds: vi.fn(async () => new Map()),
}));

import {
  loadCurtainOrderTemplate,
  loadMeshOrderTemplate,
} from "./order-template";

function orderRow(opts: {
  id: string;
  customerId: string;
  product: string;
  status: string;
  updatedAt: string;
  draft?: boolean;
}): Row {
  return {
    "orders.customer_id": opts.customerId,
    "orders.product_line": opts.product,
    "orders.current_status": opts.status,
    "orders.is_draft": opts.draft ?? false,
    "orders.updated_at": new Date(opts.updatedAt),
    id: opts.id,
    display_id: `ORD-${opts.id}`,
    property_type: "HDB",
    development: `Dev ${opts.id}`,
    site_address: `Addr ${opts.id}`,
    unit_type: "4-room",
    move_in_date: null,
    general_notes: "",
    freight_mode: "air",
    channel: "standard",
    extra_install_sgd_cents: 0,
    customer_name: "QA Customer",
    customer_salutation: null,
    customer_mobile: "9123 4567",
    customer_email: null,
  };
}

function roomRow(orderId: string, roomId = `room-${orderId}`): Row {
  return {
    "order_id": orderId,
    id: roomId,
    type: "Living Room",
    label: "Living Room",
    position: 0,
  };
}

beforeEach(() => {
  mocks.state.datasets = {};
});

describe("loadCurtainOrderTemplate", () => {
  it("copies measurements from the older unpaid order even when a newer paid order exists", async () => {
    mocks.state.datasets.orders = [
      orderRow({
        id: "paid-new",
        customerId: "c1",
        product: "curtain",
        status: "deposit_received",
        updatedAt: "2026-02-10",
      }),
      orderRow({
        id: "unpaid-old",
        customerId: "c1",
        product: "curtain",
        status: "order_recorded",
        updatedAt: "2026-01-10",
      }),
    ];
    mocks.state.datasets.rooms = [roomRow("unpaid-old")];
    mocks.state.datasets.windows = [
      {
        id: "w1",
        room_id: "room-unpaid-old",
        label: null,
        track_only: false,
        track_kind: null,
        width_cm: 210,
        height_cm: 250,
        notes: "",
        side_installation: false,
        no_installation: false,
        overlap_tracks_attachment: false,
        day_track_required: true,
        night_track_required: true,
        day_curtain_type_id: "ct-day",
        night_curtain_type_id: "ct-night",
        blind_type_id: null,
        draw: "Double",
        split_left_cm: null,
        split_right_cm: null,
        combo_id: "",
      },
    ];
    const template = await loadCurtainOrderTemplate("c1");
    expect(template?.sourceDisplayId).toBe("ORD-unpaid-old");
    expect(template?.defaults.rooms[0].windows[0]).toMatchObject({
      width_cm: 210,
      day_curtain_type_id: "ct-day",
    });
  });

  it("returns undefined when every matching-product order is paid, even if the other product is unpaid", async () => {
    mocks.state.datasets.orders = [
      orderRow({
        id: "paid-curtain",
        customerId: "c2",
        product: "curtain",
        status: "completed",
        updatedAt: "2026-01-01",
      }),
      orderRow({
        id: "unpaid-mesh",
        customerId: "c2",
        product: "mesh",
        status: "order_recorded",
        updatedAt: "2026-02-01",
      }),
    ];
    await expect(loadCurtainOrderTemplate("c2")).resolves.toBeUndefined();
  });

  it("ignores draft orders as measurement templates", async () => {
    mocks.state.datasets.orders = [
      orderRow({
        id: "draft-only",
        customerId: "c3",
        product: "curtain",
        status: "order_recorded",
        draft: true,
        updatedAt: "2026-02-01",
      }),
    ];
    await expect(loadCurtainOrderTemplate("c3")).resolves.toBeUndefined();
  });
});

describe("loadMeshOrderTemplate", () => {
  it("copies panels from an unpaid mesh order", async () => {
    mocks.state.datasets.orders = [
      orderRow({
        id: "mesh-open",
        customerId: "c4",
        product: "mesh",
        status: "quotation_sent",
        updatedAt: "2026-02-01",
      }),
    ];
    mocks.state.datasets.rooms = [roomRow("mesh-open")];
    mocks.state.datasets.mesh_panels = [
      {
        room_id: "room-mesh-open",
        category_id: "cat-1",
        colour_id: "col-1",
        width_cm: 150,
        height_cm: 220,
        has_window: true,
        has_inset_horizontal: false,
        has_inset_vertical: false,
        draw: "Left",
        split_left_cm: null,
        split_right_cm: null,
        notes: "",
        position: 0,
      },
    ];
    const template = await loadMeshOrderTemplate("c4");
    expect(template?.sourceDisplayId).toBe("ORD-mesh-open");
    expect(template?.defaults.rooms[0].panels[0]).toMatchObject({
      width_cm: 150,
      category_id: "cat-1",
    });
  });

  it("returns undefined for a paid-only mesh customer", async () => {
    mocks.state.datasets.orders = [
      orderRow({
        id: "mesh-paid",
        customerId: "c5",
        product: "mesh",
        status: "installation_completed",
        updatedAt: "2026-02-01",
      }),
    ];
    await expect(loadMeshOrderTemplate("c5")).resolves.toBeUndefined();
  });
});
