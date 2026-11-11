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

import {
  resetInstallerLink,
  saveFulfilmentArrangement,
  saveInstallationDetails,
} from "./fulfilment";

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

const token = "b31fd642-0fe2-4066-9762-880b0e023471";
const roomId = "c31fd642-0fe2-4066-9762-880b0e023471";
const windowId = "d31fd642-0fe2-4066-9762-880b0e023471";
const panelId = "e31fd642-0fe2-4066-9762-880b0e023471";
const foreignId = "f31fd642-0fe2-4066-9762-880b0e023471";

const detailsInput = (overrides: Record<string, unknown> = {}) => ({
  token,
  expected_version: 0,
  general_instructions: "Bring a 3m ladder",
  rooms: [{ room_id: roomId, note: "False ceiling" }],
  openings: [
    {
      opening_id: windowId,
      width_cm: 200,
      height_cm: 250,
      note: "Drill into concrete",
    },
  ],
  ...overrides,
});

function setupDetails(
  opts: {
    status?: string;
    productLine?: string;
    cancelledAt?: Date | null;
    version?: number;
    missingBooking?: boolean;
  } = {},
) {
  const events: { table: string; values: Record<string, unknown> }[] = [];
  const captured: { updateSet?: Record<string, unknown> } = {};
  const arrangement = opts.missingBooking
    ? undefined
    : {
        id: "arr-1",
        order_id: orderId,
        cancelled_at: opts.cancelledAt ?? null,
        installer_token: token,
        installation_details_version: opts.version ?? 0,
      };
  const trx = {
    selectFrom: (table: string) => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        where: () => chain,
        forUpdate: () => chain,
        execute: async () => [],
        executeTakeFirst: async () => undefined,
        executeTakeFirstOrThrow: async () => {
          throw new Error("empty result");
        },
      };
      if (table === "fulfilment_arrangements") {
        chain.executeTakeFirst = async () => arrangement;
        chain.executeTakeFirstOrThrow = async () => {
          if (!arrangement) throw new Error("empty result");
          return arrangement;
        };
      } else if (table === "orders") {
        chain.executeTakeFirst = async () => ({
          id: orderId,
          current_status: opts.status ?? "fulfilment",
          product_line: opts.productLine ?? "curtain",
        });
      } else if (table === "rooms") {
        chain.execute = async () => [{ id: roomId }];
      } else if (table === "windows") {
        chain.execute = async () => [{ id: windowId }];
      } else if (table === "mesh_panels") {
        chain.execute = async () => [{ id: panelId }];
      }
      return chain;
    },
    updateTable: () => ({
      set: (values: Record<string, unknown>) => {
        captured.updateSet = values;
        const next = { where: () => next, execute: async () => [] };
        return next;
      },
    }),
    insertInto: (table: string) => ({
      values: (values: Record<string, unknown>) => {
        events.push({ table, values });
        return { execute: async () => [] };
      },
    }),
  };
  mocks.transaction.mockReturnValue({
    execute: async (callback: (tx: typeof trx) => unknown) => callback(trx),
  });
  return { events, captured };
}

describe("saveInstallationDetails", () => {
  it("saves bounded overrides, bumps the version and writes a same-status audit note", async () => {
    const { events, captured } = setupDetails();
    await saveInstallationDetails(detailsInput());
    expect(captured.updateSet?.installation_details_version).toBe(1);
    const stored = JSON.parse(
      captured.updateSet?.installation_details as string,
    );
    expect(stored).toEqual({
      general_instructions: "Bring a 3m ladder",
      rooms: { [roomId]: { note: "False ceiling" } },
      openings: {
        [windowId]: {
          width_cm: 200,
          height_cm: 250,
          note: "Drill into concrete",
        },
      },
    });
    expect(events).toContainEqual({
      table: "order_status_events",
      values: expect.objectContaining({
        order_id: orderId,
        status: "fulfilment",
        created_by: "ops-user",
      }),
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/install/${token}`);
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/orders/${orderId}`);
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it("rejects a consultant before touching the booking", async () => {
    mocks.role.mockRejectedValueOnce(new Error("Forbidden"));
    await expect(
      saveInstallationDetails(detailsInput()),
    ).rejects.toThrow("Forbidden");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects a stale expected version without writing", async () => {
    const { captured } = setupDetails({ version: 3 });
    await expect(
      saveInstallationDetails(detailsInput({ expected_version: 2 })),
    ).rejects.toThrow("changed elsewhere");
    expect(captured.updateSet).toBeUndefined();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects a cancelled booking", async () => {
    const { captured } = setupDetails({ cancelledAt: new Date() });
    await expect(saveInstallationDetails(detailsInput())).rejects.toThrow(
      "no active installation booking",
    );
    expect(captured.updateSet).toBeUndefined();
  });

  it("rejects an unknown token before locking the order", async () => {
    setupDetails({ missingBooking: true });
    await expect(saveInstallationDetails(detailsInput())).rejects.toThrow(
      "no active installation booking",
    );
  });

  it("rejects writes on a completed order", async () => {
    const { captured } = setupDetails({ status: "completed" });
    await expect(saveInstallationDetails(detailsInput())).rejects.toThrow(
      "before the order is completed",
    );
    expect(captured.updateSet).toBeUndefined();
  });

  it("rejects an opening that belongs to another order", async () => {
    const { captured } = setupDetails();
    await expect(
      saveInstallationDetails(
        detailsInput({
          openings: [{ opening_id: foreignId, width_cm: 100 }],
        }),
      ),
    ).rejects.toThrow("not on this order");
    expect(captured.updateSet).toBeUndefined();
  });

  it("rejects a room note on a foreign room", async () => {
    setupDetails();
    await expect(
      saveInstallationDetails(
        detailsInput({ rooms: [{ room_id: foreignId, note: "x" }] }),
      ),
    ).rejects.toThrow("room that is not on this order");
  });

  it("rejects a window id against a mesh order", async () => {
    setupDetails({ productLine: "mesh" });
    await expect(
      saveInstallationDetails(
        detailsInput({ openings: [{ opening_id: windowId, width_cm: 100 }] }),
      ),
    ).rejects.toThrow("not on this order");
  });

  it("rejects a duplicated opening reference", async () => {
    setupDetails();
    await expect(
      saveInstallationDetails(
        detailsInput({
          openings: [
            { opening_id: windowId, width_cm: 100 },
            { opening_id: windowId, height_cm: 100 },
          ],
        }),
      ),
    ).rejects.toThrow("Duplicate installation correction");
  });

  it("saves a cleared note as an explicit empty string", async () => {
    const { captured } = setupDetails();
    await saveInstallationDetails(
      detailsInput({
        openings: [{ opening_id: windowId, note: "" }],
      }),
    );
    const stored = JSON.parse(
      captured.updateSet?.installation_details as string,
    );
    expect(stored.openings[windowId].note).toBe("");
  });

  it("keeps size overrides null on a note-only save so original data flows through", async () => {
    const { captured } = setupDetails();
    await saveInstallationDetails(
      detailsInput({
        openings: [{ opening_id: windowId, note: "Use the side gate" }],
      }),
    );
    const stored = JSON.parse(
      captured.updateSet?.installation_details as string,
    );
    expect(stored.openings[windowId]).toEqual({
      width_cm: null,
      height_cm: null,
      note: "Use the side gate",
    });
  });

  it("preserves a previously stored dimension when a later save only edits the room note", async () => {
    const { captured } = setupDetails({ version: 1 });
    await saveInstallationDetails(
      detailsInput({
        expected_version: 1,
        general_instructions: null,
        openings: [
          { opening_id: windowId, width_cm: 199, height_cm: null, note: null },
        ],
      }),
    );
    const stored = JSON.parse(
      captured.updateSet?.installation_details as string,
    );
    expect(stored.openings[windowId]).toEqual({
      width_cm: 199,
      height_cm: null,
      note: null,
    });
    expect(captured.updateSet?.installation_details_version).toBe(2);
  });

  it("trims a whitespace-only opening note to an explicit clear", async () => {
    const { captured } = setupDetails();
    await saveInstallationDetails(
      detailsInput({
        openings: [{ opening_id: windowId, note: "   " }],
      }),
    );
    const stored = JSON.parse(
      captured.updateSet?.installation_details as string,
    );
    expect(stored.openings[windowId].note).toBe("");
  });

  it("drops an emptied room note from the stored document", async () => {
    const { captured } = setupDetails();
    await saveInstallationDetails(
      detailsInput({ rooms: [{ room_id: roomId, note: "  " }] }),
    );
    const stored = JSON.parse(
      captured.updateSet?.installation_details as string,
    );
    expect(stored.rooms).toEqual({});
  });
});

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
