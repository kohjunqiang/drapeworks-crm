import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  type R = Record<string, unknown>;
  const state = { datasets: {} as Record<string, R[]> };
  const cookieStore = {
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
  };

  interface FakeSelect {
    innerJoin: (...args: unknown[]) => FakeSelect;
    select: (...args: unknown[]) => FakeSelect;
    where: (col: unknown, op?: unknown, val?: unknown) => FakeSelect;
    executeTakeFirst: () => Promise<R | undefined>;
  }

  function makeSelect(rows: R[]): FakeSelect {
    const filters: { col: string; op: string; val: unknown }[] = [];
    const chain: FakeSelect = {
      innerJoin: () => chain,
      select: () => chain,
      where: (col, op, val) => {
        if (typeof col === "string") {
          filters.push({ col, op: op as string, val });
        }
        return chain;
      },
      executeTakeFirst: async () =>
        rows.find((row) =>
          filters.every((f) => {
            const v = row[f.col];
            if (f.op === "=") return v === f.val;
            if (f.op === "in") return Array.isArray(f.val) && f.val.includes(v);
            return true;
          }),
        ),
    };
    return chain;
  }

  return { state, cookieStore, makeSelect, requireRole: vi.fn() };
});

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => mocks.cookieStore),
}));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: mocks.requireRole }));
vi.mock("@/lib/db/kysely", () => ({
  db: {
    selectFrom: (table: string) =>
      mocks.makeSelect(mocks.state.datasets[table] ?? []),
  },
}));

import { setConsultationCustomer } from "./consultation-selection";

const CUSTOMER_ID = "a31fd642-0fe2-4066-9762-880b0e023471";

function joinedRow(status: string): Record<string, unknown> {
  return {
    "customers.id": CUSTOMER_ID,
    "orders.current_status": status,
    id: CUSTOMER_ID,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.state.datasets = {};
  mocks.requireRole.mockResolvedValue({ user: { id: "u1" } });
});

describe("setConsultationCustomer", () => {
  it("remembers an eligible customer in the product-scoped cookie", async () => {
    mocks.state.datasets.customers = [joinedRow("order_recorded")];
    const result = await setConsultationCustomer({
      product: "curtain",
      customerId: CUSTOMER_ID,
    });
    expect(result).toEqual({ ok: true });
    expect(mocks.cookieStore.set).toHaveBeenCalledWith(
      "drapeworks-consultation-customer-curtain",
      CUSTOMER_ID,
      expect.objectContaining({ httpOnly: true }),
    );
    expect(mocks.cookieStore.delete).not.toHaveBeenCalled();
  });

  it.each(["order_recorded", "quotation_sent"])(
    "accepts the %s status for mesh too",
    async (status) => {
      mocks.state.datasets.customers = [joinedRow(status)];
      const result = await setConsultationCustomer({
        product: "mesh",
        customerId: CUSTOMER_ID,
      });
      expect(result).toEqual({ ok: true });
      expect(mocks.cookieStore.set).toHaveBeenCalledWith(
        "drapeworks-consultation-customer-mesh",
        CUSTOMER_ID,
        expect.anything(),
      );
    },
  );

  it("clears the cookie and reports why when the customer went paid between render and pick", async () => {
    mocks.state.datasets.customers = [joinedRow("deposit_received")];
    const result = await setConsultationCustomer({
      product: "curtain",
      customerId: CUSTOMER_ID,
    });
    expect(result).toEqual({
      ok: false,
      error: expect.stringContaining("awaiting a deposit"),
    });
    expect(mocks.cookieStore.delete).toHaveBeenCalledWith(
      "drapeworks-consultation-customer-curtain",
    );
    expect(mocks.cookieStore.set).not.toHaveBeenCalled();
  });

  it("does not throw when the customer id has no reusable orders at all", async () => {
    mocks.state.datasets.customers = [];
    const result = await setConsultationCustomer({
      product: "curtain",
      customerId: CUSTOMER_ID,
    });
    expect(result.ok).toBe(false);
    expect(mocks.cookieStore.delete).toHaveBeenCalled();
  });

  it("clears the remembered choice on a brand-new selection", async () => {
    const result = await setConsultationCustomer({
      product: "mesh",
      customerId: null,
    });
    expect(result).toEqual({ ok: true });
    expect(mocks.cookieStore.delete).toHaveBeenCalledWith(
      "drapeworks-consultation-customer-mesh",
    );
  });
});
