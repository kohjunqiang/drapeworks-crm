import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  requireRole: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: mocks.requireRole, requireSession: vi.fn() }));
vi.mock("@/lib/db/kysely", () => ({ db: { transaction: mocks.transaction } }));
vi.mock("@/lib/actions/quotations", () => ({ ensureZohoInvoiceForOrder: vi.fn() }));
vi.mock("@/lib/logistics/load", () => ({ loadOrderShipmentState: vi.fn() }));

import { advanceOrderStatus } from "./status";

const orderId = "a31fd642-0fe2-4066-9762-880b0e023471";

function setupOrder(currentStatus = "installation_completed") {
  const values = vi.fn();
  const select = {
    select: () => select,
    where: () => select,
    forUpdate: () => select,
    executeTakeFirst: async () => ({
      current_status: currentStatus, is_draft: false, appointment_id: null, lead_id: null,
    }),
  };
  const trx = {
    selectFrom: () => select,
    insertInto: vi.fn(() => ({ values: (value: unknown) => {
      values(value);
      return { execute: async () => [] };
    } })),
  };
  mocks.transaction.mockReturnValue({ execute: async (callback: (tx: typeof trx) => unknown) => callback(trx) });
  return { values, trx };
}

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
