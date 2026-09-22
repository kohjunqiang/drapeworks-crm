import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  updateTable: vi.fn(),
  role: vi.fn(),
  revalidatePath: vi.fn(),
  sync: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: mocks.role }));
vi.mock("@/lib/db/kysely", () => ({
  db: { transaction: mocks.transaction, updateTable: mocks.updateTable },
}));
vi.mock("@/lib/calendar/fulfilment-sync", () => ({
  syncFulfilmentArrangement: mocks.sync,
}));

import { resetInstallerLink, saveFulfilmentArrangement } from "./fulfilment";

const orderId = "a31fd642-0fe2-4066-9762-880b0e023471";
const input = {
  order_id: orderId,
  date: "2026-09-20",
  time: "10:00",
  duration_mins: 60,
  address: "1 Verify Way",
};

type RawShipmentRow = {
  not_needed: boolean;
  overseas_freight_number: string | null;
  arrived_checked_at: Date | null;
};

const arrived: RawShipmentRow = {
  not_needed: false,
  overseas_freight_number: "FR-1",
  arrived_checked_at: new Date("2026-09-15T00:00:00Z"),
};

function setup(
  status: string,
  opts: { shipments?: RawShipmentRow[]; previousBooking?: { cancelled_at: Date | null } | null } = {},
) {
  const state = { status, bookingCreated: false };
  const events: { table: string; values: Record<string, unknown> }[] = [];
  const captured: {
    insertValues?: Record<string, unknown>;
    updateSet?: Record<string, unknown>;
  } = {};
  let arrangementReads = 0;
  const trx = {
    selectFrom: (table: string) => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        where: () => chain,
        forUpdate: () => chain,
        execute: async () => [],
        executeTakeFirst: async () => undefined,
      };
      if (table === "orders") {
        chain.executeTakeFirst = async () => ({ current_status: state.status });
      } else if (table === "order_shipments") {
        chain.execute = async () => opts.shipments ?? [];
      } else if (table === "fulfilment_arrangements") {
        chain.executeTakeFirst = async () => {
          arrangementReads += 1;
          if (arrangementReads === 1) {
            return opts.previousBooking
              ? { id: "arr-0", cancelled_at: opts.previousBooking.cancelled_at }
              : undefined;
          }
          return state.bookingCreated ? { id: "arr-1" } : undefined;
        };
      }
      return chain;
    },
    insertInto: (table: string) => {
      if (table === "fulfilment_arrangements") {
        return {
          values: (values: Record<string, unknown>) => {
            captured.insertValues = values;
            return {
              onConflict: (callback: (conflict: unknown) => unknown) => {
                callback({
                  column: () => ({
                    doUpdateSet: (set: Record<string, unknown>) => {
                      captured.updateSet = set;
                      return {};
                    },
                  }),
                });
                state.bookingCreated = true;
                return {
                  returning: () => ({
                    executeTakeFirstOrThrow: async () => ({ id: "arr-1" }),
                  }),
                };
              },
            };
          },
        };
      }
      return {
        values: (values: Record<string, unknown> & { status?: string }) => {
          events.push({ table, values });
          if (table === "order_status_events" && values.status) {
            state.status = values.status;
          }
          return { execute: async () => [] };
        },
      };
    },
  };
  mocks.transaction.mockReturnValue({
    execute: async (callback: (tx: typeof trx) => unknown) => callback(trx),
  });
  return { events, captured };
}

const statusEvents = (events: { table: string; values: Record<string, unknown> }[]) =>
  events.filter((event) => event.table === "order_status_events");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.role.mockResolvedValue({ user: { id: "ops-user" } });
  mocks.sync.mockResolvedValue({ ok: true });
});

describe("saveFulfilmentArrangement status reconciliation", () => {
  it("keeps the Delivered & Checked booking behaviour and its audit note", async () => {
    const { events } = setup("delivered_checked", { shipments: [arrived] });
    await saveFulfilmentArrangement(input);
    expect(statusEvents(events)).toEqual([
      {
        table: "order_status_events",
        values: expect.objectContaining({
          status: "fulfilment",
          note: "Installation booked for 2026-09-20 10:00",
          created_by: "ops-user",
        }),
      },
    ]);
    expect(mocks.sync).toHaveBeenCalledWith("arr-1");
  });

  it("catches a Sent to Vendor order up to fulfilment when every shipment already arrived", async () => {
    const { events } = setup("sent_to_vendor", { shipments: [arrived, arrived] });
    await saveFulfilmentArrangement(input);
    expect(statusEvents(events).map((event) => event.values.status)).toEqual([
      "sent_logistic",
      "shipping_sg",
      "delivered_checked",
      "fulfilment",
    ]);
    expect(statusEvents(events).at(-1)?.values.note).toBe(
      "Installation booked for 2026-09-20 10:00",
    );
  });

  it("books ahead without touching status while a shipment is still pending", async () => {
    const { events } = setup("sent_to_vendor", {
      shipments: [
        arrived,
        { ...arrived, overseas_freight_number: null, arrived_checked_at: null },
      ],
    });
    await saveFulfilmentArrangement(input);
    expect(statusEvents(events)).toEqual([]);
    expect(events).toContainEqual({
      table: "fulfilment_arrangement_events",
      values: expect.objectContaining({ event_type: "booked" }),
    });
  });

  it("does not trust a manifest before vendor handoff (PO Ready booking)", async () => {
    const { events } = setup("po_ready", { shipments: [arrived] });
    await saveFulfilmentArrangement(input);
    expect(statusEvents(events)).toEqual([]);
  });

  it("rescheduling at fulfilment emits no status events", async () => {
    const { events } = setup("fulfilment", {
      shipments: [arrived],
      previousBooking: { cancelled_at: null },
    });
    await saveFulfilmentArrangement(input);
    expect(statusEvents(events)).toEqual([]);
    expect(events).toContainEqual({
      table: "fulfilment_arrangement_events",
      values: expect.objectContaining({ event_type: "rescheduled" }),
    });
  });
});

describe("saveFulfilmentArrangement installer token", () => {
  it("lets the column default mint the token on a first booking", async () => {
    const { captured } = setup("delivered_checked", { shipments: [arrived] });
    await saveFulfilmentArrangement(input);
    expect(captured.insertValues).not.toHaveProperty("installer_token");
    expect(captured.updateSet).not.toHaveProperty("installer_token");
  });

  it("keeps the token when rescheduling a live booking", async () => {
    const { captured } = setup("fulfilment", {
      shipments: [arrived],
      previousBooking: { cancelled_at: null },
    });
    await saveFulfilmentArrangement(input);
    expect(captured.updateSet).not.toHaveProperty("installer_token");
  });

  it("mints a new token when re-booking a cancelled arrangement", async () => {
    const { captured } = setup("delivered_checked", {
      shipments: [arrived],
      previousBooking: { cancelled_at: new Date("2026-09-18T00:00:00Z") },
    });
    await saveFulfilmentArrangement(input);
    expect(captured.updateSet).toHaveProperty("installer_token");
  });
});

function updateChain(result: { id: string } | undefined) {
  const chain: Record<string, unknown> = {
    set: () => chain,
    where: () => chain,
    returning: () => chain,
    executeTakeFirst: async () => result,
  };
  return chain;
}

describe("resetInstallerLink", () => {
  it("rejects a consultant before touching the booking", async () => {
    mocks.role.mockRejectedValueOnce(new Error("Forbidden"));
    await expect(
      resetInstallerLink({ order_id: orderId }),
    ).rejects.toThrow("Forbidden");
    expect(mocks.updateTable).not.toHaveBeenCalled();
  });

  it("rotates the token on an active booking and revalidates", async () => {
    mocks.updateTable.mockReturnValue(updateChain({ id: "arr-1" }));
    await resetInstallerLink({ order_id: orderId });
    expect(mocks.updateTable).toHaveBeenCalledWith("fulfilment_arrangements");
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/orders/${orderId}`);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/orders");
  });

  it("throws when the order has no active booking", async () => {
    mocks.updateTable.mockReturnValue(updateChain(undefined));
    await expect(
      resetInstallerLink({ order_id: orderId }),
    ).rejects.toThrow("No active installation booking");
  });
});
