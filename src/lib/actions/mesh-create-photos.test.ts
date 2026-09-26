import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ transaction: vi.fn(), redirect: vi.fn(), clone: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: async () => ({ user: { id: "operator" } }) }));
vi.mock("@/lib/db/kysely", () => ({ db: { transaction: mocks.transaction } }));
vi.mock("@/lib/db/mesh-catalogue", () => ({ loadActiveMeshSystemBands: async () => [] }));
vi.mock("@/lib/orders/mesh-system", () => ({ meshSystemProblems: () => [] }));
vi.mock("@/lib/actions/order-customer", () => ({ resolveOrderCustomer: async () => ({ customerId: "customer", appointmentId: null, leadId: null }), completeAppointmentForOrder: vi.fn(), updateOrderCustomerIdentity: vi.fn() }));
vi.mock("@/lib/actions/order-shared", () => ({ SEQ_PLACEHOLDERS: {}, orderMetaColumns: () => ({}), stampQuoteBaseline: vi.fn(), cloneTemplateRoomPhotos: mocks.clone, sweepPhotoStorage: vi.fn(), collectOrphanPhotoPaths: vi.fn(), deleteDroppedRooms: vi.fn() }));
import { createMeshOrder, createMeshOrderDraft } from "./mesh-orders";
const input = {
  customer: { name: "Test", mobile: "91234567" }, order: { site_address: "12 Lynwood Grove, Singapore 358172" },
  rooms: ["Living", "Bedroom"].map((label, position) => ({ type: "Living Room", label, position, panels: [{ position: 0, width_cm: 120.25, height_cm: 140.5, draw: "Single Left" }] })),
};
beforeEach(() => {
  vi.clearAllMocks();
  let room = 0;
  const trx = { insertInto: (table: string) => {
    const query = { values: () => query, returning: () => query, execute: async () => [], executeTakeFirstOrThrow: async () => ({ id: table === "rooms" ? `room-${room++}` : "order-1" }) };
    return query;
  } };
  mocks.transaction.mockReturnValue({ execute: async (fn: (tx: typeof trx) => unknown) => fn(trx) });
  mocks.redirect.mockImplementation(() => { throw new Error("NEXT_REDIRECT"); });
});
it.each([createMeshOrder, createMeshOrderDraft])("returns committed room IDs in form order for photo uploads", async (create) => {
  expect(await create(input, true)).toEqual({ orderId: "order-1", roomIds: ["room-0", "room-1"] });
  expect(mocks.redirect).not.toHaveBeenCalled();
});
it.each([createMeshOrder, createMeshOrderDraft])("preserves default redirect for callers without pending photos", async (create) => {
  await expect(create(input)).rejects.toThrow("NEXT_REDIRECT");
  expect(mocks.redirect).toHaveBeenCalledWith("/orders/order-1");
});
