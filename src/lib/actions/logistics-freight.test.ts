import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  reconcile: vi.fn(),
  role: vi.fn(),
  load: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: mocks.role }));
vi.mock("@/lib/db/kysely", () => ({ db: { transaction: mocks.transaction } }));
vi.mock("@/lib/logistics/load", () => ({ loadOrderShipmentState: mocks.load }));
vi.mock("@/lib/logistics/reconcile", () => ({
  reconcileFulfilmentStatus: mocks.reconcile,
}));
import { assignFreightComponents } from "./logistics";

const ORDER_A = "a31fd642-0fe2-4066-9762-880b0e023471";
const ORDER_B = "b31fd642-0fe2-4066-9762-880b0e023471";

type Row = {
  order_id: string;
  category: string;
  overseas_freight_number: string | null;
  overseas_freight_assigned_at: Date | null;
  arrived_checked_at: Date | null;
  not_needed: boolean;
  current_status: string;
};

function freightRow(overrides: Partial<Row> = {}): Row {
  return {
    order_id: ORDER_A,
    category: "curtains",
    overseas_freight_number: null,
    overseas_freight_assigned_at: null,
    arrived_checked_at: null,
    not_needed: false,
    current_status: "sent_to_vendor",
    ...overrides,
  };
}

function setup(rows: Row[]) {
  const updates: Record<string, unknown>[] = [];
  const trx = {
    selectFrom: (table: string) => {
      if (table !== "order_shipments") {
        throw new Error(`unexpected table ${table}`);
      }
      const chain: Record<string, unknown> = {};
      chain.innerJoin = () => chain;
      chain.select = () => chain;
      chain.where = () => chain;
      chain.forUpdate = () => chain;
      chain.execute = async () => rows;
      return chain;
    },
    updateTable: (table: string) => {
      if (table !== "order_shipments") {
        throw new Error(`unexpected update ${table}`);
      }
      const update: Record<string, unknown> = {
        set: (values: Record<string, unknown>) => {
          updates.push(values);
          return update;
        },
        where: () => update,
        executeTakeFirstOrThrow: async () => ({}),
      };
      return update;
    },
  };
  mocks.transaction.mockReturnValue({
    execute: async (fn: (tx: typeof trx) => unknown) => fn(trx),
  });
  return { updates };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.role.mockResolvedValue({ user: { id: "operator" } });
});

it("reconciles every order whose freight number changed, as the operator", async () => {
  setup([
    freightRow(),
    freightRow({
      order_id: ORDER_B,
      category: "standard_tracks",
      overseas_freight_number: "OLD-1",
      overseas_freight_assigned_at: new Date("2026-09-10T00:00:00Z"),
    }),
  ]);
  await assignFreightComponents({
    freightNumber: "FR-9",
    components: [
      { orderId: ORDER_A, category: "curtains" },
      { orderId: ORDER_B, category: "standard_tracks" },
    ],
    confirmReassign: true,
  });
  expect(mocks.reconcile).toHaveBeenCalledTimes(2);
  expect(mocks.reconcile).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ orderId: ORDER_A, createdBy: "operator" }),
  );
  expect(mocks.reconcile).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ orderId: ORDER_B, createdBy: "operator" }),
  );
});

it("reconciles an order only once when several of its components change", async () => {
  setup([
    freightRow(),
    freightRow({ category: "standard_tracks" }),
  ]);
  await assignFreightComponents({
    freightNumber: "FR-9",
    components: [
      { orderId: ORDER_A, category: "curtains" },
      { orderId: ORDER_A, category: "standard_tracks" },
    ],
  });
  expect(mocks.reconcile).toHaveBeenCalledTimes(1);
});

it("does not reconcile when the component already belongs to the code", async () => {
  const { updates } = setup([
    freightRow({
      overseas_freight_number: "fr-9",
      overseas_freight_assigned_at: new Date("2026-09-10T00:00:00Z"),
    }),
  ]);
  await assignFreightComponents({
    freightNumber: "FR-9",
    components: [{ orderId: ORDER_A, category: "curtains" }],
  });
  expect(updates).toEqual([]);
  expect(mocks.reconcile).not.toHaveBeenCalled();
});

it("rejects assignment before the order is sent to its vendor", async () => {
  const { updates } = setup([freightRow({ current_status: "po_ready" })]);
  await expect(
    assignFreightComponents({
      freightNumber: "FR-9",
      components: [{ orderId: ORDER_A, category: "curtains" }],
    }),
  ).rejects.toThrow("sent to its vendor");
  expect(updates).toEqual([]);
  expect(mocks.reconcile).not.toHaveBeenCalled();
});

it("rejects reassigning an arrived component", async () => {
  setup([
    freightRow({
      overseas_freight_number: "OLD-1",
      arrived_checked_at: new Date("2026-09-15T00:00:00Z"),
    }),
  ]);
  await expect(
    assignFreightComponents({
      freightNumber: "FR-9",
      components: [{ orderId: ORDER_A, category: "curtains" }],
      confirmReassign: true,
    }),
  ).rejects.toThrow("arrived component cannot be reassigned");
  expect(mocks.reconcile).not.toHaveBeenCalled();
});

it("requires confirmation to move a component from another code", async () => {
  setup([freightRow({ overseas_freight_number: "OLD-1" })]);
  await expect(
    assignFreightComponents({
      freightNumber: "FR-9",
      components: [{ orderId: ORDER_A, category: "curtains" }],
    }),
  ).rejects.toThrow("Confirm the components");
  expect(mocks.reconcile).not.toHaveBeenCalled();
});
