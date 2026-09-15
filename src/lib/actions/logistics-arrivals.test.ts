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
function setup(status: string, overrides = {}) {
  const shipment = { category: "standard_tracks", overseasFreightNumber: "TRACK123", updatedAt, arrivedCheckedAt: null, ...overrides };
  mocks.load.mockResolvedValue({ categories: ["standard_tracks"], shipments: [shipment] });
  const select = { select: () => select, where: () => select, forUpdate: () => select, executeTakeFirst: async () => ({ current_status: status }) };
  const set = vi.fn();
  const update = { set: (values: unknown) => { set(values); return update; }, where: () => update, executeTakeFirstOrThrow: async () => ({}) };
  const events: { table: string; values: unknown }[] = [];
  const trx = { selectFrom: () => select, updateTable: () => update, insertInto: (table: string) => ({ values: (values: unknown) => { events.push({ table, values }); return { execute: async () => [] }; } }) };
  mocks.transaction.mockReturnValue({ execute: async (fn: (tx: typeof trx) => unknown) => fn(trx) });
  return { set, events, shipment };
}
beforeEach(() => { vi.clearAllMocks(); mocks.role.mockResolvedValue({ user: { id: "operator" } }); });

it.each(["sent_to_vendor", "sent_logistic", "shipping_sg"])("records an individual arrival at %s without advancing the order", async (status) => {
  const { set, events } = setup(status);
  expect(await saveShipmentArrivals(input)).toEqual({ delivered: false });
  expect(set).toHaveBeenCalledWith(expect.objectContaining({ arrived_checked_at: expect.any(Date), arrived_checked_by: "operator" }));
  expect(events).toEqual([{ table: "order_shipment_events", values: expect.objectContaining({ category: "standard_tracks", event_type: "arrival_recorded" }) }]);
});
it.each(["sent_to_vendor", "sent_logistic"])("rejects premature order delivery at %s before writing arrivals", async (status) => {
  const { set } = setup(status);
  await expect(saveShipmentArrivals({ ...input, markDelivered: true })).rejects.toThrow("Move the order to Shipping to SG");
  expect(set).not.toHaveBeenCalled();
});
it.each(["order_recorded", "po_ready", "delivered_checked", "fulfilment", "installation_completed", "completed"])("rejects arrival edits at %s", async (status) => {
  const { set } = setup(status);
  await expect(saveShipmentArrivals(input)).rejects.toThrow("Arrival progress");
  expect(set).not.toHaveBeenCalled();
});
it.each([
  [{ overseasFreightNumber: null }, "Enter the overseas freight number"],
  [{ notNeeded: true }, "Not needed"],
  [{ updatedAt: new Date(0) }, "updated by someone else"],
] as const)("preserves validation for %j", async (overrides, error) => {
  const { set } = setup("sent_to_vendor", overrides);
  await expect(saveShipmentArrivals(input)).rejects.toThrow(error);
  expect(set).not.toHaveBeenCalled();
});
it("still advances Shipping to SG after every item has arrived", async () => {
  const { events, shipment } = setup("shipping_sg");
  mocks.load.mockResolvedValueOnce({ categories: ["standard_tracks"], shipments: [shipment] })
    .mockResolvedValueOnce({ categories: ["standard_tracks"], shipments: [{ ...shipment, arrivedCheckedAt: updatedAt }] });
  expect(await saveShipmentArrivals({ ...input, markDelivered: true })).toEqual({ delivered: true });
  expect(events).toContainEqual({ table: "order_status_events", values: expect.objectContaining({ status: "delivered_checked" }) });
});
