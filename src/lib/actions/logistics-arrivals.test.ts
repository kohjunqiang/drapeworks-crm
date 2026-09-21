import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ transaction: vi.fn(), load: vi.fn(), role: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: mocks.role }));
vi.mock("@/lib/db/kysely", () => ({ db: { transaction: mocks.transaction } }));
vi.mock("@/lib/logistics/load", () => ({ loadOrderShipmentState: mocks.load }));
import { saveShipmentArrivals } from "./logistics";

const updatedAt = new Date("2026-09-15T00:00:00Z");
const input = {
  orderId: "a31fd642-0fe2-4066-9762-880b0e023471",
  arrivals: [{ category: "standard_tracks", arrivedChecked: true, expectedUpdatedAt: updatedAt }],
};

type ShipmentInput = Record<string, unknown> & { category: string };

function setup(
  status: string,
  overrides = {},
  opts: { extraShipments?: ShipmentInput[]; booking?: boolean } = {},
) {
  const shipment = {
    category: "standard_tracks",
    overseasFreightNumber: "TRACK123",
    updatedAt,
    arrivedCheckedAt: null,
    notNeeded: false,
    arrivalNote: null,
    ...overrides,
  };
  const loadShipments = [shipment, ...(opts.extraShipments ?? [])];
  mocks.load.mockResolvedValue({
    categories: loadShipments.map((row) => row.category),
    shipments: loadShipments,
  });
  const rows = loadShipments.map((row) => ({
    category: row.category,
    not_needed: Boolean(row.notNeeded),
    overseas_freight_number: (row.overseasFreightNumber as string | null) ?? null,
    arrived_checked_at: (row.arrivedCheckedAt as Date | null) ?? null,
    arrival_note: (row.arrivalNote as string | null) ?? null,
    updated_at: (row.updatedAt as Date) ?? updatedAt,
  }));
  const state = {
    status,
    booking: opts.booking ? { id: "arr-1" } : undefined,
  };
  const set = vi.fn();
  const events: { table: string; values: Record<string, unknown> }[] = [];
  const trx = {
    selectFrom: (table: string) => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        selectAll: () => chain,
        where: () => chain,
        forUpdate: () => chain,
      };
      if (table === "orders") {
        chain.executeTakeFirst = async () => ({ current_status: state.status });
      } else if (table === "order_shipments") {
        chain.execute = async () => rows;
      } else if (table === "fulfilment_arrangements") {
        chain.executeTakeFirst = async () => state.booking;
      } else {
        throw new Error(`unexpected table ${table}`);
      }
      return chain;
    },
    updateTable: () => {
      let pendingSet: Record<string, unknown> = {};
      let targetCategory: string | undefined;
      const update: Record<string, unknown> = {
        set: (values: Record<string, unknown>) => {
          set(values);
          pendingSet = values;
          return update;
        },
        where: (column: string, _op: string, value: unknown) => {
          if (column === "category") targetCategory = value as string;
          return update;
        },
      };
      const apply = () => {
        const row = rows.find((candidate) => candidate.category === targetCategory);
        if (!row) throw new Error("no row");
        Object.assign(row, pendingSet);
        return {};
      };
      update.executeTakeFirstOrThrow = async () => apply();
      update.execute = async () => apply();
      return update;
    },
    insertInto: (table: string) => ({
      values: (values: Record<string, unknown>) => {
        events.push({ table, values });
        if (table === "order_status_events") {
          state.status = values.status as string;
        }
        return { execute: async () => [] };
      },
    }),
  };
  mocks.transaction.mockReturnValue({
    execute: async (fn: (tx: typeof trx) => unknown) => fn(trx),
  });
  return { set, events, shipment };
}

const statusEvents = (events: { table: string; values: Record<string, unknown> }[]) =>
  events.filter((event) => event.table === "order_status_events");

beforeEach(() => { vi.clearAllMocks(); mocks.role.mockResolvedValue({ user: { id: "operator" } }); });

it.each(["sent_to_vendor", "sent_logistic", "shipping_sg"])("reconciles %s to Delivered & Checked when the last required shipment arrives", async (status) => {
  const { set, events } = setup(status);
  expect(await saveShipmentArrivals(input)).toEqual({ delivered: true, status: "delivered_checked" });
  expect(set).toHaveBeenCalledWith(expect.objectContaining({ arrived_checked_at: expect.any(Date), arrived_checked_by: "operator" }));
  expect(events[0]).toEqual({ table: "order_shipment_events", values: expect.objectContaining({ category: "standard_tracks", event_type: "arrival_recorded" }) });
  expect(statusEvents(events).map((event) => event.values.status).at(-1)).toBe("delivered_checked");
});

it.each(["sent_to_vendor", "sent_logistic", "shipping_sg"])("reaches Fulfillment Arrangement at %s when installation is already booked", async (status) => {
  const { events } = setup(status, {}, { booking: true });
  await saveShipmentArrivals(input);
  expect(statusEvents(events).map((event) => event.values.status)).toContain("fulfilment");
  expect(statusEvents(events).at(-1)?.values.status).toBe("fulfilment");
});

it.each(["sent_to_vendor", "sent_logistic", "shipping_sg"])("leaves %s unchanged while another required shipment is pending", async (status) => {
  const { events } = setup(status, {}, {
    extraShipments: [{
      category: "curtains",
      overseasFreightNumber: null,
      updatedAt,
      arrivedCheckedAt: null,
      notNeeded: false,
      arrivalNote: null,
    }],
  });
  await saveShipmentArrivals(input);
  expect(statusEvents(events)).toEqual([]);
});

it.each(["sent_to_vendor", "sent_logistic"])("honours markDelivered at %s by reconciling once everything arrived", async (status) => {
  const { events } = setup(status);
  expect(await saveShipmentArrivals({ ...input, markDelivered: true })).toEqual({ delivered: true, status: "delivered_checked" });
  expect(statusEvents(events).map((event) => event.values.status).at(-1)).toBe("delivered_checked");
});
it.each(["sent_to_vendor", "sent_logistic", "shipping_sg"])("fails markDelivered at %s while a required shipment is still pending", async (status) => {
  const { events } = setup(status, {}, {
    extraShipments: [{
      category: "curtains",
      overseasFreightNumber: null,
      updatedAt,
      arrivedCheckedAt: null,
      notNeeded: false,
      arrivalNote: null,
    }],
  });
  await expect(saveShipmentArrivals({ ...input, markDelivered: true })).rejects.toThrow("arrival check");
  expect(statusEvents(events)).toEqual([]);
});
it.each(["sent_to_vendor", "sent_logistic", "shipping_sg"])("fails markDelivered at %s when freight is only a placeholder", async (status) => {
  const { events } = setup(status, { overseasFreightNumber: "N/A" });
  await expect(saveShipmentArrivals({ ...input, markDelivered: true })).rejects.toThrow("real overseas freight number");
  expect(statusEvents(events)).toEqual([]);
});
it.each(["order_recorded", "po_ready", "delivered_checked", "fulfilment", "installation_completed", "completed"])("rejects arrival edits at %s", async (status) => {
  const { set } = setup(status);
  await expect(saveShipmentArrivals(input)).rejects.toThrow("Arrival progress");
  expect(set).not.toHaveBeenCalled();
});
it.each(["N/A", "-", "none"])("rejects marking arrived with placeholder freight %j and writes nothing", async (freight) => {
  const { set, events } = setup("sent_to_vendor", { overseasFreightNumber: freight });
  await expect(saveShipmentArrivals(input)).rejects.toThrow("real overseas freight number");
  expect(set).not.toHaveBeenCalled();
  expect(events).toEqual([]);
});
it.each([
  [{ overseasFreightNumber: null }, "real overseas freight number"],
  [{ notNeeded: true }, "Not needed"],
  [{ updatedAt: new Date(0) }, "updated by someone else"],
] as const)("preserves validation for %j", async (overrides, error) => {
  const { set } = setup("sent_to_vendor", overrides);
  await expect(saveShipmentArrivals(input)).rejects.toThrow(error);
  expect(set).not.toHaveBeenCalled();
});
it("delivers a local-delivery shipment at shipping_sg without requiring a local delivery number", async () => {
  // Regression: the old markDelivered path ran the manual transition's number
  // validation, which demands local delivery numbers for Curtains — the
  // automatic catch-up must not, and must not invent one either.
  const { events } = setup("shipping_sg", { category: "curtains" });
  expect(await saveShipmentArrivals({
    orderId: input.orderId,
    arrivals: [{ category: "curtains", arrivedChecked: true, expectedUpdatedAt: updatedAt }],
    markDelivered: true,
  })).toEqual({ delivered: true, status: "delivered_checked" });
  expect(statusEvents(events).map((event) => event.values.status)).toEqual(["delivered_checked"]);
});
it("marks delivered then books into Fulfillment Arrangement when installation is already active", async () => {
  const { events } = setup("shipping_sg", {}, { booking: true });
  expect(await saveShipmentArrivals({ ...input, markDelivered: true })).toEqual({ delivered: true, status: "fulfilment" });
  expect(statusEvents(events).map((event) => event.values.status)).toEqual(["delivered_checked", "fulfilment"]);
});
