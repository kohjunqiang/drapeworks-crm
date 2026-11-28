import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

// A fake Kysely select chain that actually applies where/distinctOn/orderBy
// semantics to canned joined rows, so the eligibility predicates are exercised
// rather than merely asserted to exist.
const mocks = vi.hoisted(() => {
  type R = Record<string, unknown>;
  const state = { datasets: {} as Record<string, R[]> };

  function cell(row: R, col: string): unknown {
    return row[col];
  }

  function matches(row: R, col: string, op: string, val: unknown): boolean {
    const v = cell(row, col);
    if (op === "=") return v === val;
    if (op === "in") return Array.isArray(val) && val.includes(v);
    if (op === "is") return val === null ? v === null || v === undefined : v !== null && v !== undefined;
    return true;
  }

  function compare(a: unknown, b: unknown): number {
    if (a === b) return 0;
    if (a === null || a === undefined) return -1;
    if (b === null || b === undefined) return 1;
    const an = a instanceof Date ? a.getTime() : (a as number | string);
    const bn = b instanceof Date ? b.getTime() : (b as number | string);
    return an < bn ? -1 : 1;
  }

  interface FakeSelect {
    innerJoin: (...args: unknown[]) => FakeSelect;
    leftJoin: (...args: unknown[]) => FakeSelect;
    select: (...args: unknown[]) => FakeSelect;
    selectAll: () => FakeSelect;
    distinctOn: (col: string | string[]) => FakeSelect;
    orderBy: (col: string, dir?: "asc" | "desc") => FakeSelect;
    where: (col: unknown, op?: unknown, val?: unknown) => FakeSelect;
    execute: () => Promise<R[]>;
    executeTakeFirst: () => Promise<R | undefined>;
    executeTakeFirstOrThrow: () => Promise<R>;
  }

  function makeSelect(rows: R[]): FakeSelect {
    const filters: { col: string; op: string; val: unknown }[] = [];
    const sorts: { col: string; dir: "asc" | "desc" }[] = [];
    let distinct: string[] = [];

    function applyAll(): R[] {
      let result = rows.filter((row) =>
        filters.every((f) => matches(row, f.col, f.op, f.val)),
      );
      // Stable sort, least-significant key first.
      for (const s of [...sorts].reverse()) {
        result = [...result].sort(
          (a, b) => compare(cell(a, s.col), cell(b, s.col)) * (s.dir === "desc" ? -1 : 1),
        );
      }
      if (distinct.length > 0) {
        const seen = new Set<string>();
        result = result.filter((row) => {
          const key = distinct.map((c) => String(cell(row, c))).join("");
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      }
      return result;
    }

    const chain: FakeSelect = {
      innerJoin: () => chain,
      leftJoin: () => chain,
      select: () => chain,
      selectAll: () => chain,
      distinctOn: (col) => {
        distinct = Array.isArray(col) ? col : [col];
        return chain;
      },
      orderBy: (col, dir = "asc") => {
        sorts.push({ col, dir });
        return chain;
      },
      where: (col, op, val) => {
        if (typeof col === "string") {
          filters.push({ col, op: op as string, val });
        }
        return chain;
      },
      execute: async () => applyAll(),
      executeTakeFirst: async () => applyAll()[0],
      executeTakeFirstOrThrow: async () => {
        const row = applyAll()[0];
        if (!row) throw new Error("no result row");
        return row;
      },
    };
    return chain;
  }

  return { state, makeSelect };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/kysely", () => ({
  db: {
    selectFrom: (table: string) =>
      mocks.makeSelect(mocks.state.datasets[table] ?? []),
  },
}));

import { ATTEND_APPOINTMENT_STAGE } from "@/lib/leads/funnel-types";
import {
  loadConsultationLeadRows,
  loadRepeatCustomerRows,
  loadUnpaidCustomerPrefill,
  overlayAppointmentOntoDefaults,
} from "./consultation-customers";

const PAID_STATUSES = [
  "deposit_received",
  "po_ready",
  "sent_to_vendor",
  "sent_logistic",
  "shipping_sg",
  "delivered_checked",
  "fulfilment",
  "installation_completed",
  "completed",
];

// Joined customers×orders rows: dotted keys are the columns the queries
// filter/sort on; plain keys are the selected aliases the code reads back.
function customerOrderRow(opts: {
  customerId: string;
  name?: string;
  salutation?: string | null;
  mobile?: string;
  email?: string | null;
  orderId?: string;
  status: string;
  updatedAt: string;
  product?: string;
  draft?: boolean;
  development?: string | null;
  siteAddress?: string | null;
  deposit?: number;
}): Row {
  const product = opts.product ?? "curtain";
  return {
    "customers.id": opts.customerId,
    "orders.id": opts.orderId ?? `o-${opts.status}`,
    "orders.customer_id": opts.customerId,
    "orders.current_status": opts.status,
    "orders.updated_at": new Date(opts.updatedAt),
    "orders.product_line": product,
    "orders.is_draft": opts.draft ?? false,
    customer_id: opts.customerId,
    customer_name: opts.name ?? "QA Customer",
    customer_mobile: opts.mobile ?? "9123 4567",
    id: opts.customerId,
    name: opts.name ?? "QA Customer",
    salutation: opts.salutation ?? null,
    mobile: opts.mobile ?? "9123 4567",
    email: opts.email ?? null,
    development: opts.development ?? null,
    site_address: opts.siteAddress ?? null,
    product_line: product,
    deposit_cents: opts.deposit ?? 0,
  };
}

beforeEach(() => {
  mocks.state.datasets = {};
});

describe("loadRepeatCustomerRows", () => {
  it.each(PAID_STATUSES)(
    "excludes a customer whose only order has reached %s",
    async (status) => {
      mocks.state.datasets.customers = [
        customerOrderRow({ customerId: "c-paid", status, updatedAt: "2026-01-10" }),
      ];
      const rows = await loadRepeatCustomerRows();
      expect(rows.map((r) => r.customer_id)).not.toContain("c-paid");
    },
  );

  it.each(["order_recorded", "quotation_sent"])(
    "includes a customer whose order is %s",
    async (status) => {
      mocks.state.datasets.customers = [
        customerOrderRow({ customerId: "c-open", status, updatedAt: "2026-01-10" }),
      ];
      const rows = await loadRepeatCustomerRows();
      expect(rows.map((r) => r.customer_id)).toEqual(["c-open"]);
    },
  );

  it("includes a draft order (drafts sit at order_recorded)", async () => {
    mocks.state.datasets.customers = [
      customerOrderRow({
        customerId: "c-draft",
        status: "order_recorded",
        draft: true,
        updatedAt: "2026-01-10",
      }),
    ];
    const rows = await loadRepeatCustomerRows();
    expect(rows.map((r) => r.customer_id)).toEqual(["c-draft"]);
  });

  it("treats a positive quoted deposit as still unpaid (status, not money, is the gate)", async () => {
    mocks.state.datasets.customers = [
      customerOrderRow({
        customerId: "c-quoted",
        status: "quotation_sent",
        deposit: 240000,
        updatedAt: "2026-01-10",
      }),
    ];
    const rows = await loadRepeatCustomerRows();
    expect(rows.map((r) => r.customer_id)).toEqual(["c-quoted"]);
  });

  it("keeps a customer whose unpaid order is older than a paid one, and labels from the unpaid order", async () => {
    mocks.state.datasets.customers = [
      customerOrderRow({
        customerId: "c-mix",
        status: "completed",
        updatedAt: "2026-02-01",
        development: "Old Paid Dev",
      }),
      customerOrderRow({
        customerId: "c-mix",
        status: "order_recorded",
        updatedAt: "2026-01-01",
        development: "Unpaid Dev",
      }),
    ];
    const rows = await loadRepeatCustomerRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].customer_id).toBe("c-mix");
    // distinctOn must pick the latest ELIGIBLE order, not the latest overall.
    expect(rows[0].development).toBe("Unpaid Dev");
  });

  it("returns one row per eligible customer across products", async () => {
    mocks.state.datasets.customers = [
      customerOrderRow({ customerId: "c-a", status: "order_recorded", product: "curtain", updatedAt: "2026-01-01" }),
      customerOrderRow({ customerId: "c-a", status: "quotation_sent", product: "mesh", updatedAt: "2026-02-01" }),
      customerOrderRow({ customerId: "c-b", status: "order_recorded", product: "mesh", updatedAt: "2026-01-15" }),
    ];
    const rows = await loadRepeatCustomerRows();
    expect(rows.map((r) => r.customer_id).sort()).toEqual(["c-a", "c-b"]);
  });
});

describe("loadUnpaidCustomerPrefill", () => {
  it("resolves a stale cookie for a now-paid customer to undefined", async () => {
    mocks.state.datasets.customers = [
      customerOrderRow({ customerId: "c-gone", status: "deposit_received", updatedAt: "2026-01-10" }),
      customerOrderRow({ customerId: "c-gone", status: "completed", updatedAt: "2026-01-01" }),
    ];
    await expect(loadUnpaidCustomerPrefill("c-gone", "curtain")).resolves.toBeUndefined();
  });

  it("prefers the current product's unpaid address over the other product's", async () => {
    mocks.state.datasets.customers = [
      customerOrderRow({
        customerId: "c-cross",
        status: "order_recorded",
        product: "mesh",
        updatedAt: "2026-02-01",
        siteAddress: "Mesh Addr",
        development: "Mesh Dev",
      }),
      customerOrderRow({
        customerId: "c-cross",
        status: "order_recorded",
        product: "curtain",
        updatedAt: "2026-01-01",
        siteAddress: "Curtain Addr",
        development: "Curtain Dev",
      }),
    ];
    const curtain = await loadUnpaidCustomerPrefill("c-cross", "curtain");
    expect(curtain?.address).toBe("Curtain Addr");
    const mesh = await loadUnpaidCustomerPrefill("c-cross", "mesh");
    expect(mesh?.address).toBe("Mesh Addr");
  });

  it("still resolves identity with the other product's unpaid order when no matching product exists", async () => {
    mocks.state.datasets.customers = [
      customerOrderRow({
        customerId: "c-meshonly",
        name: "Mesh Only",
        salutation: "Mdm",
        status: "quotation_sent",
        product: "mesh",
        updatedAt: "2026-02-01",
        siteAddress: "Mesh Addr",
      }),
    ];
    const prefill = await loadUnpaidCustomerPrefill("c-meshonly", "curtain");
    expect(prefill?.customerId).toBe("c-meshonly");
    expect(prefill?.customer.name).toBe("Mesh Only");
    expect(prefill?.customer.salutation).toBe("Mdm");
    expect(prefill?.address).toBe("Mesh Addr");
  });
});

describe("loadConsultationLeadRows", () => {
  function leadRow(opts: {
    leadId: string;
    customerId: string;
    withOrder?: boolean;
  }): Row {
    return {
      "leads.id": opts.leadId,
      "leads.is_archived": false,
      "leads.funnel_stage": ATTEND_APPOINTMENT_STAGE,
      "leads.updated_at": new Date("2026-03-01"),
      ...(opts.withOrder ? { "orders.id": `o-${opts.leadId}` } : {}),
      lead_id: opts.leadId,
      lead_name: "QA Lead",
      customer_id: opts.customerId,
      customer_mobile: "9000 0000",
      appointment_development: "Appt Dev",
      lead_development: null,
    };
  }

  it("keeps a new scheduled repeat lead even though the customer's old order is paid", async () => {
    // The customer's paid history lives on other leads/orders; THIS lead has
    // no order at all, which is the whole gate.
    mocks.state.datasets.leads = [leadRow({ leadId: "l-repeat", customerId: "c-paid-history" })];
    const rows = await loadConsultationLeadRows();
    expect(rows.map((r) => r.lead_id)).toEqual(["l-repeat"]);
  });

  it("excludes a lead that already has an order", async () => {
    mocks.state.datasets.leads = [
      leadRow({ leadId: "l-ordered", customerId: "c-x", withOrder: true }),
    ];
    const rows = await loadConsultationLeadRows();
    expect(rows).toEqual([]);
  });
});

describe("overlayAppointmentOntoDefaults", () => {
  const template = {
    customer: { name: "Old Name", mobile: "9111 1111", email: "old@x.com" },
    order: { development: "Old Dev", site_address: "Old Addr" },
    rooms: [{ type: "Living Room", windows: [{ width_cm: 200 }] }],
  };

  it("lets booked identity and address win while preserving template measurements", () => {
    const merged = overlayAppointmentOntoDefaults(template, {
      customer: { name: "Booked Name", mobile: "9222 2222" },
      development: "Booked Dev",
      address: "Booked Addr",
    });
    expect(merged.customer).toEqual({
      name: "Booked Name",
      mobile: "9222 2222",
      email: "",
    });
    expect(merged.order.development).toBe("Booked Dev");
    expect(merged.order.site_address).toBe("Booked Addr");
    expect(merged.rooms).toEqual(template.rooms);
  });

  it("takes the booked salutation when present and keeps the template's when not", () => {
    const withSalutation = {
      ...template,
      customer: { ...template.customer, salutation: "Mdm" },
    };
    const booked = overlayAppointmentOntoDefaults(withSalutation, {
      customer: { name: "Booked Name", mobile: "9222 2222", salutation: "Dr" },
    });
    expect(booked.customer.salutation).toBe("Dr");
    const fallback = overlayAppointmentOntoDefaults(withSalutation, {
      customer: { name: "Booked Name", mobile: "9222 2222" },
    });
    expect(fallback.customer.salutation).toBe("Mdm");
  });

  it("falls back to the template address when the booking recorded none", () => {
    const merged = overlayAppointmentOntoDefaults(template, {
      customer: { name: "Booked Name", mobile: "9222 2222" },
      development: null,
      address: null,
    });
    expect(merged.order.development).toBe("Old Dev");
    expect(merged.order.site_address).toBe("Old Addr");
  });
});
