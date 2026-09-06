import type { Transaction } from "kysely";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AppointmentStatus, DB } from "@/lib/db/schema";
import type { FunnelStage } from "@/lib/leads/funnel-types";

vi.mock("server-only", () => ({}));

import { completeAppointmentForOrder, resolveOrderCustomer } from "./order-customer";

type Insert = { table: string; values: Record<string, unknown> };
type Update = { table: string; values: Record<string, unknown> };

function fakeTransaction(options: {
  appointmentStatus?: AppointmentStatus;
  leadStage?: FunnelStage;
}) {
  const inserts: Insert[] = [];
  const updates: Update[] = [];

  const builder = (result?: Record<string, unknown>) => {
    const chain = {
      select: () => chain,
      where: () => chain,
      forUpdate: () => chain,
      returning: () => chain,
      set: (values?: Record<string, unknown>) => {
        void values;
        return chain;
      },
      values: (values?: Record<string, unknown>) => {
        void values;
        return chain;
      },
      execute: async () => [],
      executeTakeFirst: async () => result,
      executeTakeFirstOrThrow: async () => {
        if (!result) throw new Error("missing fake row");
        return result;
      },
    };
    return chain;
  };

  const trx = {
    selectFrom(table: string) {
      if (table === "appointments") {
        return builder(options.appointmentStatus ? {
          lead_id: "lead-1",
          scheduled_at: new Date("2026-09-02T02:00:00Z"),
          status: options.appointmentStatus,
        } : undefined);
      }
      if (table === "leads") {
        return builder({ funnel_stage: options.leadStage ?? "Attend Appointment" });
      }
      throw new Error(`Unexpected select: ${table}`);
    },
    updateTable(table: string) {
      const chain = builder({});
      chain.set = (values?: Record<string, unknown>) => {
        if (values) updates.push({ table, values });
        return chain;
      };
      return chain;
    },
    insertInto(table: string) {
      const chain = builder();
      chain.values = (values?: Record<string, unknown>) => {
        if (values) inserts.push({ table, values });
        return chain;
      };
      return chain;
    },
  };

  return { trx: trx as unknown as Transaction<DB>, inserts, updates };
}

describe("completeAppointmentForOrder", () => {
  beforeEach(() => vi.useRealTimers());

  it("atomically completes a scheduled appointment and advances its lead", async () => {
    const { trx, inserts, updates } = fakeTransaction({ appointmentStatus: "scheduled" });

    await completeAppointmentForOrder(trx, "appointment-1", "lead-1", "user-1");

    expect(updates.map(item => item.table)).toEqual(["appointments", "leads"]);
    expect(inserts.map(item => item.table)).toEqual([
      "appointment_events",
      "lead_stage_events",
    ]);
    expect(updates[1].values).toMatchObject({
      funnel_stage: "Send Quotation",
      last_outcome: null,
      next_action_date: null,
    });
  });

  it("advances a directly selected lead when no appointment was linked", async () => {
    const { trx, inserts, updates } = fakeTransaction({});

    await completeAppointmentForOrder(trx, null, "lead-1", "user-1");

    expect(updates.map(item => item.table)).toEqual(["leads"]);
    expect(inserts.map(item => item.table)).toEqual(["lead_stage_events"]);
  });

  it("does not duplicate completion history for an already completed appointment", async () => {
    const { trx, inserts, updates } = fakeTransaction({
      appointmentStatus: "completed",
      leadStage: "Send Quotation",
    });

    await completeAppointmentForOrder(trx, "appointment-1", "lead-1", "user-1");

    expect(updates.map(item => item.table)).toEqual(["leads"]);
    expect(inserts).toEqual([]);
  });

  it.each(["cancelled", "no_show"] as const)(
    "rejects a %s appointment",
    async status => {
      const { trx, inserts, updates } = fakeTransaction({ appointmentStatus: status });

      await expect(
        completeAppointmentForOrder(trx, "appointment-1", "lead-1", "user-1"),
      ).rejects.toThrow("cannot finish a consultation");
      expect(inserts).toEqual([]);
      expect(updates).toEqual([]);
    },
  );
});

describe("resolveOrderCustomer", () => {
  function fakeResolveTransaction({
    appointmentCustomerId = "customer-1",
    leadCustomerId = "customer-1",
  }: {
    appointmentCustomerId?: string;
    leadCustomerId?: string | null;
  } = {}) {
    const selectedTables: string[] = [];
    const updatedTables: string[] = [];
    const rows: Record<string, Record<string, unknown> | undefined> = {
      appointments: {
        id: "appointment-1",
        lead_id: "lead-1",
        customer_id: appointmentCustomerId,
        status: "scheduled",
      },
      leads: {
        id: "lead-1",
        customer_id: leadCustomerId,
        funnel_stage: "Attend Appointment",
        is_archived: false,
      },
      customers: { id: "customer-1" },
      orders: undefined,
    };

    type ResolveChain = {
      select: () => ResolveChain;
      where: () => ResolveChain;
      forUpdate: () => ResolveChain;
      returning: () => ResolveChain;
      set: () => ResolveChain;
      values: () => ResolveChain;
      $if: (
        condition: boolean,
        callback: (query: ResolveChain) => ResolveChain,
      ) => ResolveChain;
      execute: () => Promise<unknown[]>;
      executeTakeFirst: () => Promise<Record<string, unknown> | undefined>;
      executeTakeFirstOrThrow: () => Promise<Record<string, unknown>>;
    };

    const builder = (result?: Record<string, unknown>) => {
      const chain = {} as ResolveChain;
      Object.assign(chain, {
        select: () => chain,
        where: () => chain,
        forUpdate: () => chain,
        returning: () => chain,
        set: () => chain,
        values: () => chain,
        $if: (
          condition: boolean,
          callback: (query: ResolveChain) => ResolveChain,
        ) => (condition ? callback(chain) : chain),
        execute: async () => [],
        executeTakeFirst: async () => result,
        executeTakeFirstOrThrow: async () => {
          if (!result) throw new Error("missing fake row");
          return result;
        },
      });
      return chain;
    };

    const trx = {
      selectFrom(table: string) {
        selectedTables.push(table);
        return builder(rows[table]);
      },
      updateTable(table: string) {
        updatedTables.push(table);
        return builder({});
      },
      insertInto() {
        return builder({ id: "new-customer" });
      },
    } as unknown as Transaction<DB>;

    return { trx, selectedTables, updatedTables };
  }

  it("recovers the scheduled appointment when the lead picker sends only leadId", async () => {
    const { trx, selectedTables } = fakeResolveTransaction();

    const result = await resolveOrderCustomer(
      trx,
      undefined,
      "lead-1",
      { name: "Kenny", mobile: "91234567" },
      "user-1",
    );

    expect(selectedTables).toEqual(["appointments", "leads", "orders"]);
    expect(result).toEqual({
      customerId: "customer-1",
      appointmentId: "appointment-1",
      leadId: "lead-1",
    });
  });

  it("reuses a selected customer without attaching the new order to an old lead", async () => {
    const { trx, selectedTables, updatedTables } = fakeResolveTransaction();

    const result = await resolveOrderCustomer(
      trx,
      undefined,
      undefined,
      { name: "Kenny", mobile: "91234567" },
      "user-1",
      "customer-1",
    );

    expect(selectedTables).toEqual(["customers"]);
    expect(updatedTables).toEqual(["customers"]);
    expect(result).toEqual({
      customerId: "customer-1",
      appointmentId: null,
      leadId: null,
    });
  });

  it("rejects an ambiguous lead and existing-customer selection", async () => {
    const { trx, selectedTables, updatedTables } = fakeResolveTransaction();

    await expect(resolveOrderCustomer(
      trx,
      undefined,
      "lead-1",
      { name: "Kenny", mobile: "91234567" },
      "user-1",
      "customer-1",
    )).rejects.toThrow("either an appointment lead or an existing customer");

    expect(selectedTables).toEqual([]);
    expect(updatedTables).toEqual([]);
  });

  it("rejects an appointment linked to a different customer than its lead", async () => {
    const { trx } = fakeResolveTransaction({
      appointmentCustomerId: "customer-appointment",
      leadCustomerId: "customer-lead",
    });

    await expect(resolveOrderCustomer(
      trx,
      undefined,
      "lead-1",
      { name: "Kenny", mobile: "91234567" },
      "user-1",
    )).rejects.toThrow("belong to different customers");
  });

  it("repairs a missing legacy lead customer from its locked appointment", async () => {
    const { trx, updatedTables } = fakeResolveTransaction({ leadCustomerId: null });

    const result = await resolveOrderCustomer(
      trx,
      undefined,
      "lead-1",
      { name: "Kenny", mobile: "91234567" },
      "user-1",
    );

    expect(updatedTables).toEqual(["leads", "customers"]);
    expect(result).toMatchObject({
      customerId: "customer-1",
      appointmentId: "appointment-1",
      leadId: "lead-1",
    });
  });
});
