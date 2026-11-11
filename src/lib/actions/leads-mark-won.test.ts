import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(), revalidatePath: vi.fn(), transaction: vi.fn(),
  selectFrom: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: mocks.requireRole }));
vi.mock("@/lib/db/kysely", () => ({
  db: { transaction: mocks.transaction, selectFrom: mocks.selectFrom },
}));

import { markLeadAsWon, searchWonLinkOrders } from "./leads";

const LEAD = "00000000-0000-4000-8000-0000000000a1";
const OTHER_LEAD = "00000000-0000-4000-8000-0000000000a9";
const CUSTOMER = "00000000-0000-4000-8000-0000000000b1";
const OTHER_CUSTOMER = "00000000-0000-4000-8000-0000000000b9";
const ORDER = "00000000-0000-4000-8000-0000000000c1";
const OLD_ORDER = "00000000-0000-4000-8000-0000000000c9";
const ACTOR = "00000000-0000-4000-8000-0000000000d1";
const VERSION = "2026-11-10T10:00:00.123Z";

type Row = Record<string, unknown>;
type State = {
  lead?: Row | null;
  orders?: Row[];
  appointment?: Row | null;
  updateReturnsRow?: boolean;
};

function harness(state: State) {
  const updates: { table: string; values: Row }[] = [];
  const inserts: { table: string; values: Row }[] = [];
  const selectCalls: { table: string; method: string }[] = [];
  const setConfig = vi.fn(async () => ({ rows: [] }));

  const builder = (table: string, rows: Row[] | undefined) => {
    const chain = {
      select: () => chain,
      where: () => chain,
      orderBy: () => chain,
      forUpdate: () => chain,
      leftJoin: () => chain,
      innerJoin: () => chain,
      limit: () => chain,
      execute: async () => rows ?? [],
      executeTakeFirst: async () => rows?.[0],
      executeTakeFirstOrThrow: async () => {
        if (!rows?.[0]) throw new Error("missing fake row");
        return rows[0];
      },
    };
    void table;
    return chain;
  };

  const trx = {
    selectFrom(table: string) {
      selectCalls.push({ table, method: "selectFrom" });
      if (table === "orders") return builder(table, state.orders ?? []);
      if (table === "leads") {
        return builder(table, state.lead ? [state.lead] : []);
      }
      if (table === "appointments") {
        return builder(table, state.appointment ? [state.appointment] : []);
      }
      return builder(table, []);
    },
    updateTable(table: string) {
      const chain = {
        set: (values: Row) => {
          updates.push({ table, values });
          return chain;
        },
        where: () => chain,
        returning: () => chain,
        execute: async () => [],
        executeTakeFirst: async () =>
          state.updateReturnsRow === false ? undefined : { id: "x" },
        executeTakeFirstOrThrow: async () => ({ id: "x" }),
      };
      return chain;
    },
    insertInto(table: string) {
      return {
        values: (values: Row) => {
          inserts.push({ table, values });
          return { execute: async () => [] };
        },
      };
    },
    getExecutor: () => ({
      transformQuery: (node: unknown) => node,
      compileQuery: () => ({}),
      executeQuery: setConfig,
      provideConnection: async (fn: (conn: unknown) => Promise<unknown>) => fn({}),
    }),
  };

  mocks.transaction.mockReturnValue({
    execute: (callback: (t: unknown) => Promise<unknown>) => callback(trx),
  });
  return { updates, inserts, setConfig };
}

const baseOrder = (overrides: Row = {}): Row => ({
  id: ORDER, customer_id: CUSTOMER, current_status: "deposit_received",
  is_draft: false, lead_id: null, display_id: "DW-2026-0007",
  appointment_id: null, ...overrides,
});
const baseLead = (overrides: Row = {}): Row => ({
  id: LEAD, lead_ref: "MN-1", funnel_stage: "Decision Pending",
  customer_id: null, is_archived: false,
  updated_at: new Date(VERSION), ...overrides,
});
const input = (overrides: Record<string, unknown> = {}) => ({
  lead_id: LEAD, order_id: ORDER, expected_updated_at: VERSION,
  expected_linked_order_id: null, ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireRole.mockResolvedValue({ user: { id: ACTOR } });
});

describe("markLeadAsWon", () => {
  it("links an unlinked deposited order and closes a null-customer lead Won", async () => {
    const { updates, inserts, setConfig } = harness({
      lead: baseLead(), orders: [baseOrder()],
    });
    await expect(markLeadAsWon(input())).resolves.toEqual({ ok: true });
    const leadUpdate = updates.find(u => u.table === "leads");
    expect(leadUpdate?.values).toMatchObject({
      funnel_stage: "Won", last_outcome: "Customer Confirmed",
      customer_id: CUSTOMER, closure_reason: null, next_action_date: null,
      action_detail: null,
    });
    const orderUpdate = updates.find(u => u.table === "orders");
    expect(orderUpdate?.values).toEqual({ lead_id: LEAD });
    expect(inserts.map(i => i.table)).toEqual([
      "order_status_events", "lead_stage_events", "lead_interactions",
    ]);
    expect(inserts[0].values).toMatchObject({
      order_id: ORDER, status: "deposit_received", created_by: ACTOR,
    });
    expect(inserts[1].values).toMatchObject({
      lead_id: LEAD, from_stage: "Decision Pending", to_stage: "Won",
      changed_by: ACTOR, source: "user",
    });
    expect(setConfig).toHaveBeenCalled();
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/orders/${ORDER}`);
  });

  it("closes a stale lead through its already-linked eligible order without touching the order", async () => {
    const { updates, inserts } = harness({
      lead: baseLead({ customer_id: CUSTOMER }),
      orders: [baseOrder({ lead_id: LEAD })],
    });
    await expect(markLeadAsWon(input({ expected_linked_order_id: ORDER })))
      .resolves.toEqual({ ok: true });
    expect(updates.filter(u => u.table === "orders")).toEqual([]);
    expect(updates.find(u => u.table === "leads")?.values)
      .toMatchObject({ funnel_stage: "Won" });
    expect(updates.find(u => u.table === "leads")?.values)
      .not.toHaveProperty("customer_id");
    expect(inserts.map(i => i.table)).toEqual([
      "lead_stage_events", "lead_interactions",
    ]);
  });

  it("replaces a pre-deposit link only when replacement is confirmed", async () => {
    const state = {
      lead: baseLead({ customer_id: CUSTOMER }),
      orders: [
        baseOrder({ id: OLD_ORDER, lead_id: LEAD, current_status: "order_recorded", display_id: "DW-2026-0001" }),
        baseOrder(),
      ],
    };
    const first = harness(state);
    await expect(markLeadAsWon(input({ expected_linked_order_id: OLD_ORDER })))
      .resolves.toEqual({
        ok: false, error: expect.stringContaining("Confirm replacing"),
      });
    expect(first.updates).toEqual([]);
    expect(first.inserts).toEqual([]);

    const second = harness(state);
    await expect(markLeadAsWon(input({
      expected_linked_order_id: OLD_ORDER, replace_linked_order: true,
    }))).resolves.toEqual({ ok: true });
    const orderUpdates = second.updates.filter(u => u.table === "orders");
    expect(orderUpdates.map(u => u.values)).toEqual([
      { lead_id: null }, { lead_id: LEAD },
    ]);
    const events = second.inserts.filter(i => i.table === "order_status_events");
    expect(events.map(e => e.values.order_id)).toEqual([OLD_ORDER, ORDER]);
  });

  it("refuses to replace a linked order that already has a recorded deposit", async () => {
    const { updates, inserts } = harness({
      lead: baseLead({ customer_id: CUSTOMER }),
      orders: [
        baseOrder({ id: OLD_ORDER, lead_id: LEAD, current_status: "installation_completed" }),
        baseOrder(),
      ],
    });
    await expect(markLeadAsWon(input({
      expected_linked_order_id: OLD_ORDER, replace_linked_order: true,
    }))).resolves.toEqual({ ok: false, error: expect.stringContaining("Confirm that order") });
    expect(updates).toEqual([]);
    expect(inserts).toEqual([]);
  });

  it("fails closed on a linked order with an unrecognised status — never a replaceable pre-deposit", async () => {
    const { updates, inserts } = harness({
      lead: baseLead({ customer_id: CUSTOMER }),
      orders: [
        baseOrder({
          id: OLD_ORDER, lead_id: LEAD,
          current_status: "future_enum_value" as never,
        }),
        baseOrder(),
      ],
    });
    await expect(markLeadAsWon(input({
      expected_linked_order_id: OLD_ORDER, replace_linked_order: true,
    }))).resolves.toEqual({ ok: false, error: expect.stringContaining("unrecognised status") });
    expect(updates).toEqual([]);
    expect(inserts).toEqual([]);
  });

  it("is idempotent: a repeat submit after success writes nothing", async () => {
    const { updates, inserts } = harness({
      lead: baseLead({ funnel_stage: "Won", customer_id: CUSTOMER }),
      orders: [baseOrder({ lead_id: LEAD })],
    });
    await expect(markLeadAsWon(input())).resolves.toEqual({ ok: true });
    expect(updates).toEqual([]);
    expect(inserts).toEqual([]);
  });

  it.each([
    ["draft order", baseOrder({ is_draft: true }), "draft consultation"],
    ["pre-deposit order", baseOrder({ current_status: "quotation_sent" }), "Record the deposit"],
    ["order linked to another lead", baseOrder({ lead_id: OTHER_LEAD }), "different lead"],
  ])("rejects a %s without writing", async (_name, order, message) => {
    const { updates, inserts } = harness({ lead: baseLead(), orders: [order] });
    await expect(markLeadAsWon(input()))
      .resolves.toEqual({ ok: false, error: expect.stringContaining(message) });
    expect(updates).toEqual([]);
    expect(inserts).toEqual([]);
  });

  it("rejects an order for a different customer without merging identities", async () => {
    const { updates, inserts } = harness({
      lead: baseLead({ customer_id: OTHER_CUSTOMER }),
      orders: [baseOrder()],
    });
    await expect(markLeadAsWon(input()))
      .resolves.toEqual({ ok: false, error: expect.stringContaining("different customer") });
    expect(updates).toEqual([]);
    expect(inserts).toEqual([]);
  });

  it("rejects a null-customer lead whose appointment belongs to another customer", async () => {
    const { updates, inserts } = harness({
      lead: baseLead(),
      orders: [baseOrder()],
      appointment: { lead_id: LEAD, customer_id: OTHER_CUSTOMER },
    });
    await expect(markLeadAsWon(input()))
      .resolves.toEqual({ ok: false, error: expect.stringContaining("appointment belongs to a different customer") });
    expect(updates).toEqual([]);
    expect(inserts).toEqual([]);
  });

  it("rejects a selected order whose appointment points at a different lead", async () => {
    const { updates, inserts } = harness({
      lead: baseLead({ customer_id: CUSTOMER }),
      orders: [baseOrder({ appointment_id: "appt-1" })],
      appointment: { lead_id: OTHER_LEAD, customer_id: CUSTOMER },
    });
    await expect(markLeadAsWon(input()))
      .resolves.toEqual({ ok: false, error: expect.stringContaining("different lead or customer") });
    expect(updates).toEqual([]);
    expect(inserts).toEqual([]);
  });

  it("rejects an archived or missing lead", async () => {
    const archived = harness({ lead: baseLead({ is_archived: true }), orders: [baseOrder()] });
    await expect(markLeadAsWon(input()))
      .resolves.toEqual({ ok: false, error: expect.stringContaining("no longer available") });
    expect(archived.updates).toEqual([]);

    const missing = harness({ lead: null, orders: [baseOrder()] });
    await expect(markLeadAsWon(input()))
      .resolves.toEqual({ ok: false, error: expect.stringContaining("no longer available") });
    expect(missing.updates).toEqual([]);
  });

  it("returns a friendly reopen message for a stale version with no writes", async () => {
    const { updates, inserts } = harness({
      lead: baseLead({ updated_at: new Date("2026-11-10T10:00:00.999Z") }),
      orders: [baseOrder()],
    });
    await expect(markLeadAsWon(input())).resolves.toEqual({
      ok: false, error: expect.stringContaining("changed since you opened"),
    });
    expect(updates).toEqual([]);
    expect(inserts).toEqual([]);
  });

  it("returns the same reopen message when the guarded update still misses", async () => {
    const { updates, inserts } = harness({
      lead: baseLead(), orders: [baseOrder()], updateReturnsRow: false,
    });
    await expect(markLeadAsWon(input())).resolves.toEqual({
      ok: false, error: expect.stringContaining("changed since you opened"),
    });
    expect(updates.filter(u => u.table !== "leads")).toEqual([]);
    expect(inserts).toEqual([]);
  });

  it("rejects when the reviewed linked order changed before confirming", async () => {
    const { updates, inserts } = harness({
      lead: baseLead({ customer_id: CUSTOMER }),
      orders: [baseOrder({ lead_id: LEAD })],
    });
    await expect(markLeadAsWon(input({ expected_linked_order_id: OLD_ORDER })))
      .resolves.toEqual({
        ok: false,
        error: expect.stringContaining("linked to this lead changed"),
      });
    expect(updates).toEqual([]);
    expect(inserts).toEqual([]);
  });

  it("rejects ops and unauthenticated callers through the role guard", async () => {
    mocks.requireRole.mockRejectedValue(new Error("not found"));
    await expect(markLeadAsWon(input())).rejects.toThrow("not found");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});

describe("searchWonLinkOrders", () => {
  it.each(["a", " a ", 42, null, { term: "" }])(
    "rejects malformed or too-short input %j without hitting the database",
    async term => {
      await expect(searchWonLinkOrders(term)).rejects.toThrow();
      expect(mocks.selectFrom).not.toHaveBeenCalled();
    },
  );
});
