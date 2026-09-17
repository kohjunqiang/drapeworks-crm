import { describe, expect, it } from "vitest";

import type { FulfilmentStatus } from "@/lib/db/schema";

import { reconcileFulfilmentStatus } from "./reconcile";

const orderId = "a31fd642-0fe2-4066-9762-880b0e023471";
const actor = "ops-user";

type ShipmentRow = {
  not_needed: boolean;
  overseas_freight_number: string | null;
  arrived_checked_at: Date | null;
};

type StatusEvent = {
  order_id: string;
  status: FulfilmentStatus;
  note: string | null;
  created_by: string | null;
};

/** Minimal in-memory executor; the status insert mirrors the sync trigger. */
function fakeDb(state: {
  status: FulfilmentStatus;
  shipments?: ShipmentRow[];
  booking?: { id: string } | null;
}) {
  const events: StatusEvent[] = [];
  const terminals: Record<
    string,
    { executeTakeFirst?: () => Promise<unknown>; execute?: () => Promise<unknown> }
  > = {
    orders: {
      executeTakeFirst: async () => ({ current_status: state.status }),
    },
    order_shipments: { execute: async () => state.shipments ?? [] },
    fulfilment_arrangements: {
      executeTakeFirst: async () => state.booking ?? undefined,
    },
  };
  const trx = {
    selectFrom: (table: string) => {
      const terminal = terminals[table];
      if (!terminal) throw new Error(`unexpected table ${table}`);
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.where = () => chain;
      chain.forUpdate = () => chain;
      chain.executeTakeFirst = () => terminal.executeTakeFirst?.();
      chain.execute = () => terminal.execute?.();
      return chain;
    },
    insertInto: (table: string) => {
      if (table !== "order_status_events") {
        throw new Error(`unexpected insert into ${table}`);
      }
      return {
        values: (value: StatusEvent) => {
          events.push(value);
          state.status = value.status;
          return { execute: async () => [] };
        },
      };
    },
  };
  return { trx: trx as never, events };
}

const arrived = (freight = "FR-1"): ShipmentRow => ({
  not_needed: false,
  overseas_freight_number: freight,
  arrived_checked_at: new Date("2026-09-15T00:00:00Z"),
});
const pending: ShipmentRow = {
  not_needed: false,
  overseas_freight_number: "FR-2",
  arrived_checked_at: null,
};

describe("reconcileFulfilmentStatus", () => {
  it.each(["sent_to_vendor", "sent_logistic", "shipping_sg"] as const)(
    "walks %s to delivered_checked when every required shipment arrived",
    async (status) => {
      const { trx, events } = fakeDb({
        status,
        shipments: [arrived(), arrived("FR-2")],
      });
      const result = await reconcileFulfilmentStatus(trx, {
        orderId,
        createdBy: actor,
      });
      expect(result).toEqual({
        from: status,
        to: "delivered_checked",
        emitted: expect.any(Array),
      });
      expect(result.emitted.at(-1)).toBe("delivered_checked");
      expect(events.map((event) => event.status).at(-1)).toBe(
        "delivered_checked",
      );
      for (const event of events) {
        expect(event).toMatchObject({
          order_id: orderId,
          created_by: actor,
          note: "Auto-reconciled: every required shipment arrived and checked.",
        });
      }
    },
  );

  it.each(["sent_to_vendor", "sent_logistic", "shipping_sg"] as const)(
    "walks %s to fulfilment when an installation booking is already active",
    async (status) => {
      const { trx, events } = fakeDb({
        status,
        shipments: [arrived()],
        booking: { id: "arr-1" },
      });
      const result = await reconcileFulfilmentStatus(trx, {
        orderId,
        createdBy: actor,
      });
      expect(result.to).toBe("fulfilment");
      expect(events.at(-1)).toMatchObject({
        status: "fulfilment",
        note: "Auto-reconciled: an installation booking is active.",
      });
    },
  );

  it("keeps the booking-provided note on the fulfilment event", async () => {
    const { trx, events } = fakeDb({
      status: "delivered_checked",
      shipments: [arrived()],
      booking: { id: "arr-1" },
    });
    await reconcileFulfilmentStatus(trx, {
      orderId,
      createdBy: actor,
      fulfilmentNote: "Installation booked for 2026-09-18 10:00",
    });
    expect(events).toEqual([
      expect.objectContaining({
        status: "fulfilment",
        note: "Installation booked for 2026-09-18 10:00",
      }),
    ]);
  });

  it.each(["sent_to_vendor", "sent_logistic", "shipping_sg"] as const)(
    "leaves %s alone while any required shipment is still pending",
    async (status) => {
      const { trx, events } = fakeDb({
        status,
        shipments: [arrived(), pending],
        booking: { id: "arr-1" },
      });
      const result = await reconcileFulfilmentStatus(trx, {
        orderId,
        createdBy: actor,
      });
      expect(result.emitted).toEqual([]);
      expect(events).toEqual([]);
    },
  );

  it("never advances on an empty manifest", async () => {
    const { trx, events } = fakeDb({ status: "sent_to_vendor", shipments: [] });
    const result = await reconcileFulfilmentStatus(trx, {
      orderId,
      createdBy: actor,
    });
    expect(result.emitted).toEqual([]);
    expect(events).toEqual([]);
  });

  it("never advances when every shipment is marked not needed", async () => {
    const { trx, events } = fakeDb({
      status: "shipping_sg",
      shipments: [{ ...arrived(), not_needed: true }],
    });
    const result = await reconcileFulfilmentStatus(trx, {
      orderId,
      createdBy: actor,
    });
    expect(result.emitted).toEqual([]);
    expect(events).toEqual([]);
  });

  it("ignores not-needed rows when the remaining manifest has arrived", async () => {
    const { trx, events } = fakeDb({
      status: "sent_logistic",
      shipments: [arrived(), { ...pending, not_needed: true }],
    });
    const result = await reconcileFulfilmentStatus(trx, {
      orderId,
      createdBy: actor,
    });
    expect(result.to).toBe("delivered_checked");
    expect(events).toHaveLength(2);
  });

  it.each(["N/A", "-", null] as const)(
    "requires a real freight number, not placeholder %j",
    async (freight) => {
      const { trx, events } = fakeDb({
        status: "shipping_sg",
        shipments: [{ ...arrived(), overseas_freight_number: freight }],
      });
      const result = await reconcileFulfilmentStatus(trx, {
        orderId,
        createdBy: actor,
      });
      expect(result.emitted).toEqual([]);
      expect(events).toEqual([]);
    },
  );

  it("reaches only delivered_checked when the booking was cancelled", async () => {
    const { trx } = fakeDb({
      status: "sent_to_vendor",
      shipments: [arrived()],
      booking: null,
    });
    const result = await reconcileFulfilmentStatus(trx, {
      orderId,
      createdBy: actor,
    });
    expect(result.to).toBe("delivered_checked");
  });

  it.each(["fulfilment", "installation_completed", "completed"] as const)(
    "never regresses %s",
    async (status) => {
      const { trx, events } = fakeDb({ status, shipments: [arrived()] });
      const result = await reconcileFulfilmentStatus(trx, {
        orderId,
        createdBy: actor,
      });
      expect(result).toEqual({ from: status, to: status, emitted: [] });
      expect(events).toEqual([]);
    },
  );

  it.each(["order_recorded", "deposit_received", "po_ready"] as const)(
    "does not trust a manifest before vendor handoff (%s)",
    async (status) => {
      const { trx, events } = fakeDb({ status, shipments: [arrived()] });
      const result = await reconcileFulfilmentStatus(trx, {
        orderId,
        createdBy: actor,
      });
      expect(result.emitted).toEqual([]);
      expect(events).toEqual([]);
    },
  );

  it("is idempotent — a repeat call emits no duplicate events", async () => {
    const state = {
      status: "sent_to_vendor" as FulfilmentStatus,
      shipments: [arrived()],
      booking: { id: "arr-1" },
    };
    const { trx, events } = fakeDb(state);
    const first = await reconcileFulfilmentStatus(trx, {
      orderId,
      createdBy: actor,
    });
    expect(first.to).toBe("fulfilment");
    const second = await reconcileFulfilmentStatus(trx, {
      orderId,
      createdBy: actor,
    });
    expect(second).toEqual({ from: "fulfilment", to: "fulfilment", emitted: [] });
    expect(events).toHaveLength(first.emitted.length);
  });

  it("applies the operator note prefix to generated notes", async () => {
    const { trx, events } = fakeDb({
      status: "shipping_sg",
      shipments: [arrived()],
    });
    await reconcileFulfilmentStatus(trx, {
      orderId,
      createdBy: null,
      notePrefix: "[REPAIR] ",
    });
    expect(events).toEqual([
      expect.objectContaining({
        status: "delivered_checked",
        created_by: null,
        note: "[REPAIR] Auto-reconciled: every required shipment arrived and checked.",
      }),
    ]);
  });

  it("throws when the order does not exist", async () => {
    const terminals = {
      selectFrom: () => {
        const chain: Record<string, unknown> = {};
        chain.select = () => chain;
        chain.where = () => chain;
        chain.forUpdate = () => chain;
        chain.executeTakeFirst = async () => undefined;
        return chain;
      },
    };
    await expect(
      reconcileFulfilmentStatus(terminals as never, {
        orderId,
        createdBy: actor,
      }),
    ).rejects.toThrow("Order not found");
  });
});
