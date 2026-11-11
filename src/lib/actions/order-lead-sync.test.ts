import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { resolveLeadForOrderSync } from "./order-customer";

const LEAD_ID = "c31fd642-0fe2-4066-9762-880b0e023473";
const APPT_ID = "d31fd642-0fe2-4066-9762-880b0e023474";
const OTHER_ORDER_ID = "e31fd642-0fe2-4066-9762-880b0e023475";

const lead = { id: LEAD_ID, funnel_stage: "Won" as const };

function fakeTrx(rows: {
  appointment?: { lead_id: string | null };
  lead?: typeof lead;
  canonicalOrder?: { id: string };
} = {}) {
  const selectCalls: string[] = [];
  const forUpdateTables: string[] = [];
  const trx = {
    selectFrom: (table: string) => {
      selectCalls.push(table);
      const result =
        table === "appointments" ? rows.appointment
        : table === "leads" ? rows.lead
        : table === "orders" ? rows.canonicalOrder
        : undefined;
      const chain: Record<string, unknown> = {
        select: () => chain,
        where: () => chain,
        forUpdate: () => {
          forUpdateTables.push(table);
          return chain;
        },
        executeTakeFirst: async () => result,
      };
      return chain;
    },
  };
  return { trx: trx as never, selectCalls, forUpdateTables };
}

describe("resolveLeadForOrderSync", () => {
  it("treats an explicit orders.lead_id as authoritative and skips fallback reads", async () => {
    const { trx, selectCalls, forUpdateTables } = fakeTrx({ lead });
    const resolved = await resolveLeadForOrderSync(trx, {
      lead_id: LEAD_ID,
      appointment_id: APPT_ID,
    });
    expect(resolved).toEqual(lead);
    expect(selectCalls).toEqual(["leads"]);
    expect(forUpdateTables).toEqual(["leads"]);
  });

  it("resolves nothing for a detached order whose appointment lead now has a canonical order", async () => {
    // The Mark as Won replacement path: the old order kept appointment_id but
    // lost orders.lead_id, and the new deposited order owns the lead.
    const { trx, selectCalls, forUpdateTables } = fakeTrx({
      appointment: { lead_id: LEAD_ID },
      lead,
      canonicalOrder: { id: OTHER_ORDER_ID },
    });
    const resolved = await resolveLeadForOrderSync(trx, {
      lead_id: null,
      appointment_id: APPT_ID,
    });
    expect(resolved).toBeNull();
    // The canonical check runs only after the lead row lock was taken.
    expect(selectCalls).toEqual(["appointments", "leads", "orders"]);
    expect(forUpdateTables).toEqual(["leads"]);
  });

  it("keeps the legacy appointment fallback when no order owns the lead", async () => {
    const { trx } = fakeTrx({
      appointment: { lead_id: LEAD_ID },
      lead,
      canonicalOrder: undefined,
    });
    const resolved = await resolveLeadForOrderSync(trx, {
      lead_id: null,
      appointment_id: APPT_ID,
    });
    expect(resolved).toEqual(lead);
  });

  it("resolves nothing for an unlinked order with no appointment", async () => {
    const { trx, selectCalls } = fakeTrx();
    const resolved = await resolveLeadForOrderSync(trx, {
      lead_id: null,
      appointment_id: null,
    });
    expect(resolved).toBeNull();
    expect(selectCalls).toEqual([]);
  });

  it("resolves nothing when the appointment is gone", async () => {
    const { trx, selectCalls } = fakeTrx({ appointment: undefined });
    const resolved = await resolveLeadForOrderSync(trx, {
      lead_id: null,
      appointment_id: APPT_ID,
    });
    expect(resolved).toBeNull();
    expect(selectCalls).toEqual(["appointments"]);
  });

  it("resolves nothing when the fallback candidate lead no longer exists", async () => {
    const { trx, selectCalls } = fakeTrx({
      appointment: { lead_id: LEAD_ID },
      lead: undefined,
    });
    const resolved = await resolveLeadForOrderSync(trx, {
      lead_id: null,
      appointment_id: APPT_ID,
    });
    expect(resolved).toBeNull();
    expect(selectCalls).toEqual(["appointments", "leads"]);
  });
});
