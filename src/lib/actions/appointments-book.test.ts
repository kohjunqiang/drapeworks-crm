import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(), revalidatePath: vi.fn(),
  syncAppointment: vi.fn(), unsyncAppointment: vi.fn(),
  transaction: vi.fn(), selectFrom: vi.fn(), updateTable: vi.fn(), insertInto: vi.fn(),
  set: vi.fn(),
  lead: undefined as Record<string, unknown> | undefined,
  existingAppointment: undefined as { id: string } | undefined,
  consultant: undefined as { id: string } | undefined,
  appointmentsWhere: [] as unknown[][],
  inserts: [] as { table: string; values: Record<string, unknown> }[],
}));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: mocks.requireRole }));
vi.mock("@/lib/calendar/sync", () => ({ syncAppointment: mocks.syncAppointment, unsyncAppointment: mocks.unsyncAppointment }));
vi.mock("@/lib/db/kysely", () => ({ db: { transaction: mocks.transaction } }));

import { bookAppointment } from "./appointments";

const LEAD = "00000000-0000-4000-8000-000000000001";
const CONSULTANT = "00000000-0000-4000-8000-000000000002";
const OWNER = "00000000-0000-4000-8000-000000000003";
const APPOINTMENT = "00000000-0000-4000-8000-000000000004";

const booking = () => ({
  lead_id: LEAD, consultant_id: CONSULTANT,
  date: "2026-12-05", time: "14:00", duration_mins: 90,
  development: "Seaside Residences", address: "12 Lynwood Grove, Singapore 358172",
  customer: { mode: "new", name: "Bren", mobile: "9123 4567" },
});

const OPEN_STAGES = [
  "Qualify Lead", "Nurture Lead – Long Term", "Activate Lead – Short Term",
  "Book Appointment", "Attend Appointment", "Send Quotation",
  "Collect Deposit", "Decision Pending",
] as const;

const resultFor = (table: string) =>
  table === "leads" ? mocks.lead
    : table === "appointments" ? mocks.existingAppointment
    : table === "profiles" ? mocks.consultant
    : undefined;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.lead = { funnel_stage: "Qualify Lead", last_outcome: "Awaiting Customer", next_action_date: "2026-11-20", is_archived: false };
  mocks.existingAppointment = undefined;
  mocks.consultant = { id: CONSULTANT };
  mocks.appointmentsWhere = [];
  mocks.inserts = [];
  mocks.requireRole.mockResolvedValue({ user: { id: OWNER } });
  mocks.syncAppointment.mockResolvedValue({ ok: true });
  mocks.selectFrom.mockImplementation((table: string) => {
    const builder: Record<string, unknown> = {};
    builder.select = vi.fn(() => builder);
    builder.where = vi.fn((...args: unknown[]) => { if (table === "appointments") mocks.appointmentsWhere.push(args); return builder; });
    builder.forUpdate = vi.fn(() => builder);
    builder.executeTakeFirst = vi.fn(async () => resultFor(table));
    builder.executeTakeFirstOrThrow = vi.fn(async () => resultFor(table));
    return builder;
  });
  mocks.updateTable.mockImplementation(() => ({
    set: mocks.set.mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn().mockReturnThis(),
    execute: vi.fn().mockResolvedValue([]),
    executeTakeFirst: vi.fn(async () => ({ id: APPOINTMENT })),
  }));
  mocks.insertInto.mockImplementation((table: string) => ({
    values: (values: Record<string, unknown>) => {
      mocks.inserts.push({ table, values });
      return { execute: vi.fn().mockResolvedValue([]),
        returning: vi.fn().mockReturnThis(), executeTakeFirstOrThrow: vi.fn(async () => ({ id: APPOINTMENT })) };
    },
  }));
  mocks.transaction.mockReturnValue({ execute: (callback: (trx: unknown) => Promise<unknown>) =>
    callback({ selectFrom: mocks.selectFrom, updateTable: mocks.updateTable, insertInto: mocks.insertInto }),
  });
});

describe("bookAppointment stage gating", () => {
  it.each(OPEN_STAGES)("books a %s lead in one visit without a prior stage save", async stage => {
    mocks.lead!.funnel_stage = stage;
    await bookAppointment(booking());
    const appointment = mocks.inserts.find(entry => entry.table === "appointments");
    expect(appointment?.values).toMatchObject({
      lead_id: LEAD, status: "scheduled",
      lead_stage_before: stage, lead_outcome_before: "Awaiting Customer",
      lead_action_date_before: "2026-11-20",
    });
    expect(mocks.set).toHaveBeenCalledWith(expect.objectContaining({
      funnel_stage: "Attend Appointment", last_outcome: "Appointment Booked",
      next_action_date: "2026-12-05", assigned_consultant_id: CONSULTANT,
    }));
    expect(mocks.syncAppointment).toHaveBeenCalledWith(APPOINTMENT);
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/leads/${LEAD}`);
  });

  it("audits the move to Attend Appointment from the actual prior stage", async () => {
    mocks.lead!.funnel_stage = "Decision Pending";
    await bookAppointment(booking());
    expect(mocks.inserts.map(entry => entry.table)).toEqual(["customers", "appointments", "appointment_events", "lead_stage_events"]);
    expect(mocks.inserts[3].values).toMatchObject({
      lead_id: LEAD, from_stage: "Decision Pending", to_stage: "Attend Appointment", source: "system",
    });
  });

  it("skips the stage event when the lead is already at Attend Appointment", async () => {
    mocks.lead!.funnel_stage = "Attend Appointment";
    await bookAppointment(booking());
    expect(mocks.inserts.some(entry => entry.table === "lead_stage_events")).toBe(false);
    expect(mocks.set).toHaveBeenCalledWith(expect.objectContaining({ funnel_stage: "Attend Appointment" }));
  });

  it.each(["Won", "Lost", "Not Qualified"] as const)("rejects a %s lead before writing anything", async stage => {
    mocks.lead!.funnel_stage = stage;
    await expect(bookAppointment(booking())).rejects.toThrow(/closed/);
    expect(mocks.insertInto).not.toHaveBeenCalled();
    expect(mocks.updateTable).not.toHaveBeenCalled();
    expect(mocks.syncAppointment).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it.each([undefined, { is_archived: true }])("rejects a missing or archived lead before writing", async archived => {
    mocks.lead = archived === undefined ? undefined : { ...mocks.lead, is_archived: true };
    await expect(bookAppointment(booking())).rejects.toThrow("no longer available");
    expect(mocks.insertInto).not.toHaveBeenCalled();
    expect(mocks.syncAppointment).not.toHaveBeenCalled();
  });
});

describe("bookAppointment guards", () => {
  it("refuses a second booking while one is still scheduled", async () => {
    mocks.existingAppointment = { id: APPOINTMENT };
    await expect(bookAppointment(booking())).rejects.toThrow("already has a scheduled appointment");
    expect(mocks.insertInto).not.toHaveBeenCalled();
    expect(mocks.syncAppointment).not.toHaveBeenCalled();
  });

  it("only counts scheduled appointments, so a cancelled one can be rebooked", async () => {
    await bookAppointment(booking());
    expect(mocks.appointmentsWhere).toContainEqual(["status", "=", "scheduled"]);
    expect(mocks.inserts.some(entry => entry.table === "appointments")).toBe(true);
  });

  it("rejects an inactive or non-consultant assignee before writing", async () => {
    mocks.consultant = undefined;
    await expect(bookAppointment(booking())).rejects.toThrow("Select an active consultant");
    expect(mocks.insertInto).not.toHaveBeenCalled();
    expect(mocks.syncAppointment).not.toHaveBeenCalled();
  });

  it("rejects malformed input before opening a transaction", async () => {
    await expect(bookAppointment({ lead_id: "not-a-uuid" })).rejects.toThrow();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
