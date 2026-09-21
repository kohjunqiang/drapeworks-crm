import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  requireRole: vi.fn(),
  revalidatePath: vi.fn(),
  load: vi.fn(),
  ensureZohoInvoiceForOrder: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: mocks.requireRole, requireSession: vi.fn() }));
vi.mock("@/lib/db/kysely", () => ({ db: { transaction: mocks.transaction } }));
vi.mock("@/lib/actions/quotations", () => ({ ensureZohoInvoiceForOrder: mocks.ensureZohoInvoiceForOrder }));
vi.mock("@/lib/logistics/load", () => ({ loadOrderShipmentState: mocks.load }));

import { UserFacingError } from "@/lib/user-facing-error";
import { advanceOrderStatus, advanceOrderStatusUi } from "./status";

const orderId = "a31fd642-0fe2-4066-9762-880b0e023471";

type RawShipmentRow = {
  not_needed: boolean;
  overseas_freight_number: string | null;
  arrived_checked_at: Date | null;
};

function setupOrder(
  currentStatus = "installation_completed",
  opts: { shipments?: RawShipmentRow[]; booking?: boolean } = {},
) {
  const state = { status: currentStatus };
  const values = vi.fn();
  const shipmentWrites: {
    value: Record<string, unknown>;
    set: Record<string, unknown>;
  }[] = [];
  const trx = {
    selectFrom: (table: string) => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        where: () => chain,
        forUpdate: () => chain,
        executeTakeFirst: async () => undefined,
        execute: async () => [],
      };
      if (table === "orders") {
        chain.executeTakeFirst = async () => ({
          current_status: state.status,
          is_draft: false,
          appointment_id: null,
          lead_id: null,
        });
      } else if (table === "order_shipments") {
        chain.execute = async () => opts.shipments ?? [];
      } else if (table === "fulfilment_arrangements") {
        chain.executeTakeFirst = async () =>
          opts.booking ? { id: "arr-1" } : undefined;
      }
      return chain;
    },
    insertInto: vi.fn((table: string) => ({
      values: (value: { status?: string } & Record<string, unknown>) => {
        values(value);
        if (table === "order_status_events" && value.status) {
          state.status = value.status;
        }
        return {
          execute: async () => [],
          onConflict: (
            callback: (conflict: {
              columns: () => {
                doUpdateSet: (set: Record<string, unknown>) => unknown;
              };
            }) => unknown,
          ) => {
            callback({
              columns: () => ({
                doUpdateSet: (set: Record<string, unknown>) => {
                  shipmentWrites.push({ value, set });
                  return {};
                },
              }),
            });
            return { execute: async () => [] };
          },
        };
      },
    })),
  };
  mocks.transaction.mockReturnValue({ execute: async (callback: (tx: typeof trx) => unknown) => callback(trx) });
  return { values, shipmentWrites, state, trx };
}

const arrivedShipment: RawShipmentRow = {
  not_needed: false,
  overseas_freight_number: "FR-1",
  arrived_checked_at: new Date("2026-09-15T00:00:00Z"),
};

const arrivedShipmentState = {
  categories: ["standard_tracks"],
  shipments: [{
    category: "standard_tracks",
    notNeeded: false,
    localDeliveryNumber: null,
    overseasFreightNumber: "FR-1",
    overseasFreightAssignedAt: null,
    arrivedCheckedAt: new Date("2026-09-15T00:00:00Z"),
    arrivalNote: null,
    legacyLocalDeliveryNumber: null,
    legacyOverseasFreightNumber: null,
    source: "derived",
    updatedAt: new Date("2026-09-15T00:00:00Z"),
  }],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireRole.mockResolvedValue({ user: { id: "ops-user" } });
});

describe("order completion payment confirmation", () => {
  it("marks installation completed without requesting payment confirmation", async () => {
    const { values } = setupOrder("fulfilment");
    await advanceOrderStatus({ orderId, expectedStatus: "fulfilment" });
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ status: "installation_completed", note: null }));
  });

  it.each([undefined, false, "true", 1])("rejects completion with confirmation %s", async (confirmation) => {
    const { trx } = setupOrder();
    await expect(advanceOrderStatus({ orderId, expectedStatus: "installation_completed", balanceReceivedConfirmed: confirmation })).rejects.toThrow();
    expect(trx.insertInto).not.toHaveBeenCalled();
  });

  it("records explicit receipt confirmation and the operator in the completion event", async () => {
    const { values } = setupOrder();
    await advanceOrderStatus({ orderId, expectedStatus: "installation_completed", balanceReceivedConfirmed: true, note: " Paid by PayNow " });
    expect(values).toHaveBeenCalledWith({
      order_id: orderId,
      status: "completed",
      note: "Confirmed remaining balance received in full.\n\nPaid by PayNow",
      created_by: "ops-user",
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/orders/${orderId}`);
  });

  it("preserves confirmation when no optional note was supplied", async () => {
    const { values } = setupOrder();
    await advanceOrderStatus({ orderId, expectedStatus: "installation_completed", balanceReceivedConfirmed: true });
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ note: "Confirmed remaining balance received in full." }));
  });

  it("still rejects stale submissions even with receipt confirmation", async () => {
    const { trx } = setupOrder("completed");
    await expect(advanceOrderStatus({ orderId, expectedStatus: "installation_completed", balanceReceivedConfirmed: true })).rejects.toThrow("already changed");
    expect(trx.insertInto).not.toHaveBeenCalled();
  });

  it("does not require final payment at earlier stages", async () => {
    const { values } = setupOrder("deposit_received");
    await advanceOrderStatus({ orderId, expectedStatus: "deposit_received" });
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ status: "po_ready", note: null }));
  });
});

describe("arrival catch-up during a manual advance", () => {
  it("walks the remaining milestones when the manifest already arrived", async () => {
    mocks.load.mockResolvedValue(arrivedShipmentState);
    const { values } = setupOrder("sent_to_vendor", { shipments: [arrivedShipment] });
    await advanceOrderStatus({ orderId, expectedStatus: "sent_to_vendor" });
    const statuses = values.mock.calls.map(([value]) => (value as { status?: string }).status);
    expect(statuses).toEqual(["sent_logistic", "shipping_sg", "delivered_checked"]);
    expect(values).toHaveBeenLastCalledWith(expect.objectContaining({
      status: "delivered_checked",
      note: "Auto-reconciled: every required shipment arrived and checked.",
      created_by: "ops-user",
    }));
  });

  it("continues to fulfilment when an installation booking is active", async () => {
    mocks.load.mockResolvedValue(arrivedShipmentState);
    const { values } = setupOrder("sent_to_vendor", { shipments: [arrivedShipment], booking: true });
    await advanceOrderStatus({ orderId, expectedStatus: "sent_to_vendor" });
    const statuses = values.mock.calls.map(([value]) => (value as { status?: string }).status);
    expect(statuses).toEqual(["sent_logistic", "shipping_sg", "delivered_checked", "fulfilment"]);
  });

  it("advances one step then catches up to shipping_sg once every shipment has freight", async () => {
    mocks.load.mockResolvedValue(arrivedShipmentState);
    const { values } = setupOrder("sent_to_vendor", {
      shipments: [{ ...arrivedShipment, arrived_checked_at: null }],
    });
    await advanceOrderStatus({ orderId, expectedStatus: "sent_to_vendor" });
    const statuses = values.mock.calls.map(([value]) => (value as { status?: string }).status);
    expect(statuses).toEqual(["sent_logistic", "shipping_sg"]);
    expect(values).toHaveBeenLastCalledWith(expect.objectContaining({
      status: "shipping_sg",
      note: "Auto-reconciled: every required shipment has an overseas freight number.",
      created_by: "ops-user",
    }));
  });
});

describe("tracking numbers on arrived shipments during a manual advance", () => {
  const arrivedCurtains = {
    category: "curtains",
    notNeeded: false,
    localDeliveryNumber: "LD-1",
    overseasFreightNumber: "FR-9",
    overseasFreightAssignedAt: new Date("2026-09-10T00:00:00Z"),
    arrivedCheckedAt: new Date("2026-09-15T00:00:00Z"),
    arrivalNote: null,
    legacyLocalDeliveryNumber: null,
    legacyOverseasFreightNumber: null,
    source: "derived",
    updatedAt: new Date("2026-09-15T00:00:00Z"),
  };
  const pendingTracks = {
    category: "standard_tracks",
    notNeeded: false,
    localDeliveryNumber: null,
    overseasFreightNumber: null,
    overseasFreightAssignedAt: null,
    arrivedCheckedAt: null,
    arrivalNote: null,
    legacyLocalDeliveryNumber: null,
    legacyOverseasFreightNumber: null,
    source: "derived",
    updatedAt: new Date("2026-09-15T00:00:00Z"),
  };
  const manifest = {
    categories: ["curtains", "standard_tracks"],
    shipments: [arrivedCurtains, pendingTracks],
  };
  const rawRows: RawShipmentRow[] = [
    {
      not_needed: false,
      overseas_freight_number: "FR-9",
      arrived_checked_at: new Date("2026-09-15T00:00:00Z"),
    },
    {
      not_needed: false,
      overseas_freight_number: null,
      arrived_checked_at: null,
    },
  ];
  const staleSubmit = (freight: string | undefined) => ({
    orderId,
    expectedStatus: "sent_logistic",
    shipmentNumbers: [
      {
        category: "curtains",
        localDeliveryNumber: "LD-1",
        overseasFreightNumber: freight,
      },
      { category: "standard_tracks", overseasFreightNumber: "FR-77" },
    ],
  });

  it.each([undefined, "FR-10"])(
    "rejects a stale freight rewrite (%s) on the arrived component and writes nothing",
    async (freight) => {
      mocks.load.mockResolvedValue(manifest);
      const { values, shipmentWrites, state } = setupOrder("sent_logistic", {
        shipments: rawRows,
      });
      await expect(advanceOrderStatus(staleSubmit(freight))).rejects.toThrow(
        /already arrived and checked.*reopen/,
      );
      expect(state.status).toBe("sent_logistic");
      expect(shipmentWrites).toEqual([]);
      expect(values).not.toHaveBeenCalled();
    },
  );

  it("rejects the advance while a required shipment still lacks a freight number", async () => {
    mocks.load.mockResolvedValue(manifest);
    const { values, shipmentWrites, state } = setupOrder("sent_logistic", {
      shipments: rawRows,
    });
    await expect(
      advanceOrderStatus({
        orderId,
        expectedStatus: "sent_logistic",
        shipmentNumbers: [
          {
            category: "curtains",
            localDeliveryNumber: "LD-1",
            overseasFreightNumber: "FR-9",
          },
          { category: "standard_tracks" },
        ],
      }),
    ).rejects.toThrow("Enter an overseas freight number for every shipment.");
    expect(state.status).toBe("sent_logistic");
    expect(shipmentWrites).toEqual([]);
    expect(values).not.toHaveBeenCalled();
  });

  it("advances when the freight-less shipment is marked not needed", async () => {
    const notNeededTracks = { ...pendingTracks, notNeeded: true };
    mocks.load.mockResolvedValue({
      categories: ["curtains", "standard_tracks"],
      shipments: [arrivedCurtains, notNeededTracks],
    });
    const { values, shipmentWrites } = setupOrder("sent_logistic", {
      shipments: [
        rawRows[0],
        { ...rawRows[1], not_needed: true },
      ],
    });
    await advanceOrderStatus({
      orderId,
      expectedStatus: "sent_logistic",
      shipmentNumbers: [
        {
          category: "curtains",
          localDeliveryNumber: "LD-1",
          overseasFreightNumber: "FR-9",
        },
        { category: "standard_tracks" },
      ],
    });
    expect(shipmentWrites).toEqual([]);
    const statuses = values.mock.calls
      .map(([value]) => (value as { status?: string }).status)
      .filter(Boolean);
    expect(statuses[0]).toBe("shipping_sg");
  });

  it("accepts the unchanged freight number and still writes the pending component", async () => {
    mocks.load.mockResolvedValue(manifest);
    const { values, shipmentWrites } = setupOrder("sent_logistic", {
      shipments: rawRows,
    });
    await advanceOrderStatus(staleSubmit("FR-9"));
    expect(shipmentWrites.map((write) => write.value.category)).toEqual([
      "standard_tracks",
    ]);
    expect(shipmentWrites[0].set.overseas_freight_number).toBe("FR-77");
    const statuses = values.mock.calls
      .map(([value]) => (value as { status?: string }).status)
      .filter(Boolean);
    expect(statuses).toEqual(["shipping_sg"]);
  });

  it("guards the local handoff at sent_to_vendor the same way", async () => {
    mocks.load.mockResolvedValue(manifest);
    const { values, shipmentWrites, state } = setupOrder("sent_to_vendor", {
      shipments: rawRows,
    });
    await expect(
      advanceOrderStatus({
        orderId,
        expectedStatus: "sent_to_vendor",
        shipmentNumbers: [
          { category: "curtains", localDeliveryNumber: "LD-2" },
          { category: "standard_tracks" },
        ],
      }),
    ).rejects.toThrow(/already arrived and checked.*reopen/);
    expect(state.status).toBe("sent_to_vendor");
    expect(shipmentWrites).toEqual([]);
    expect(values).not.toHaveBeenCalled();
  });

  it("advances the local handoff when the arrived numbers are unchanged", async () => {
    mocks.load.mockResolvedValue(manifest);
    const { values, shipmentWrites } = setupOrder("sent_to_vendor", {
      shipments: rawRows,
    });
    await advanceOrderStatus({
      orderId,
      expectedStatus: "sent_to_vendor",
      shipmentNumbers: [
        { category: "curtains", localDeliveryNumber: "LD-1" },
        { category: "standard_tracks" },
      ],
    });
    expect(shipmentWrites).toEqual([]);
    const statuses = values.mock.calls
      .map(([value]) => (value as { status?: string }).status)
      .filter(Boolean);
    expect(statuses).toEqual(["sent_logistic"]);
  });
});

describe("advanceOrderStatusUi result wrapper", () => {
  const invoiceInput = { orderId, expectedStatus: "quotation_sent" };

  it("returns the deliberate invoice message without opening the status transaction", async () => {
    const deliberate = new UserFacingError(
      "The sent Zoho quotation no longer matches the CRM snapshot; reconcile it before creating an invoice",
    );
    mocks.ensureZohoInvoiceForOrder.mockRejectedValue(deliberate);
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await advanceOrderStatusUi(invoiceInput);

    expect(result).toEqual({
      ok: false,
      error: "The sent Zoho quotation no longer matches the CRM snapshot; reconcile it before creating an invoice",
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it("returns a generic fallback for an unexpected raw error and never leaks it", async () => {
    mocks.ensureZohoInvoiceForOrder.mockRejectedValue(
      new Error("RAW-SECRET-401 oauth_token=abc123"),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await advanceOrderStatusUi(invoiceInput);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("The order status could not be updated. Refresh and try again.");
      expect(result.error).not.toContain("RAW-SECRET");
    }
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("still enforces the ops/admin role guard", async () => {
    mocks.requireRole.mockRejectedValue(new Error("Forbidden"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await advanceOrderStatusUi(invoiceInput);

    expect(result.ok).toBe(false);
    expect(mocks.ensureZohoInvoiceForOrder).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
