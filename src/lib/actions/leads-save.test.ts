import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(), revalidatePath: vi.fn(), transaction: vi.fn(),
  selectFrom: vi.fn(), updateTable: vi.fn(), insertInto: vi.fn(),
  forUpdate: vi.fn(), updateWhere: vi.fn(), set: vi.fn(),
  before: {} as Record<string, unknown>,
  updated: undefined as { id: string } | undefined,
  inserts: [] as { table: string; values: Record<string, unknown> }[],
}));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: mocks.requireRole }));
vi.mock("@/lib/db/kysely", () => ({ db: { transaction: mocks.transaction } }));

import { logLeadUpdate, quickEditLead } from "./leads";

const id = "00000000-0000-4000-8000-000000000001";
const owner = "00000000-0000-4000-8000-000000000002";
const version = "2026-08-31T10:00:00.123Z";
const edit = () => ({ id, owner_id: owner, expected_updated_at: version,
  name: "Customer", funnel_stage: "Qualify Lead", contact_channel: "Other",
  source: "", primary_product: "Both", latest_quote_sgd: "", move_in_date: "",
});
const log = () => ({ lead_id: id, expected_updated_at: version,
  funnel_stage: "Qualify Lead", last_outcome: "Customer Replied",
  direction: "Outbound", interaction_type: "Note", quote_valid_days: 7,
});
const savedInteraction = { table: "lead_interactions", values: {
  lead_id: id, occurred_at: expect.any(Date), direction: null,
  interaction_type: "Note", note: "Lead details saved", created_by: owner,
} };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.before = { funnel_stage: "Qualify Lead", move_in_date: null,
    last_outcome: null, quote_valid_days: 7 };
  mocks.updated = { id };
  mocks.inserts = [];
  mocks.requireRole.mockResolvedValue({ user: { id: owner } });
  const select = {
    select: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(),
    forUpdate: mocks.forUpdate.mockReturnThis(),
    executeTakeFirstOrThrow: vi.fn(async () => mocks.before),
  };
  const update = {
    set: mocks.set.mockReturnThis(), where: mocks.updateWhere.mockReturnThis(),
    returning: vi.fn().mockReturnThis(), executeTakeFirst: vi.fn(async () => mocks.updated),
  };
  mocks.selectFrom.mockReturnValue(select);
  mocks.updateTable.mockReturnValue(update);
  mocks.insertInto.mockImplementation((table: string) => ({
    values: (values: Record<string, unknown>) => {
      mocks.inserts.push({ table, values });
      return { execute: vi.fn().mockResolvedValue([]) };
    },
  }));
  mocks.transaction.mockReturnValue({ execute: (callback: (trx: unknown) => Promise<void>) =>
    callback({ selectFrom: mocks.selectFrom, updateTable: mocks.updateTable, insertInto: mocks.insertInto }),
  });
});

describe("Versioned lead saves", () => {
  it.each([quickEditLead, logLeadUpdate])("rejects a stale version before writing history or refreshing UI", async action => {
    mocks.updated = undefined;
    await expect(action(action === quickEditLead ? edit() : log())).rejects.toThrow("changed since you opened");
    expect(mocks.forUpdate).toHaveBeenCalledOnce();
    expect(mocks.insertInto).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("places the fetched timestamp in the update predicate", async () => {
    await quickEditLead(edit());
    expect(mocks.updateWhere).toHaveBeenNthCalledWith(1, "id", "=", id);
    const predicate = mocks.updateWhere.mock.calls[1][0] as { toOperationNode(): {
      sqlFragments: string[]; parameters: { value: unknown }[];
    } };
    const node = predicate.toOperationNode();
    expect(node.sqlFragments.join("")).toContain("date_trunc('milliseconds', updated_at)");
    expect(node.parameters[0].value).toEqual(new Date(version));
  });

  it("audits stage changes and resets dismissed recommendations", async () => {
    await quickEditLead({ ...edit(), funnel_stage: "Book Appointment" });
    expect(mocks.set.mock.calls[0][0]).toHaveProperty("dismissed_recommendations");
    expect(mocks.inserts).toEqual([savedInteraction, { table: "lead_stage_events", values: {
      lead_id: id, from_stage: "Qualify Lead", to_stage: "Book Appointment",
      changed_at: expect.any(Date), changed_by: owner, source: "user",
    } }]);
  });

  it("does not create a stage event or invalidate recommendations for unchanged workflow fields", async () => {
    await quickEditLead(edit());
    expect(mocks.inserts).toEqual([savedInteraction]);
    expect(mocks.set.mock.calls[0][0]).not.toHaveProperty("dismissed_recommendations");
  });

  it("invalidates move-in recommendations without recording a stage change", async () => {
    await quickEditLead({ ...edit(), move_in_date: "2026-10-01" });
    expect(mocks.set.mock.calls[0][0]).toHaveProperty("dismissed_recommendations");
    expect(mocks.inserts).toEqual([savedInteraction]);
  });

  it("preserves omitted optional fields and explicitly clears empty optional values", async () => {
    await quickEditLead(edit());
    for (const field of ["keys_collected", "interaction_summary", "latest_quote_note", "historical_summary", "quotation_breakdown"]) {
      expect(mocks.set.mock.calls[0][0]).not.toHaveProperty(field);
    }
    await quickEditLead({ ...edit(), keys_collected: "", historical_summary: "", quotation_breakdown: "" });
    expect(mocks.set.mock.calls[1][0]).toMatchObject({ keys_collected: null, historical_summary: null, quotation_breakdown: null });
  });

  it("preserves newlines and historical product values through validation and persistence", async () => {
    await quickEditLead({ ...edit(), action_detail: "First line\nSecond line", latest_quote_note: "Curtain\nMesh" });
    expect(mocks.set.mock.calls[0][0]).toMatchObject({ action_detail: "First line\nSecond line", latest_quote_note: "Curtain\nMesh", primary_product: "Both" });
  });

  it("automatically logs every full lead save as a non-contact note", async () => {
    await quickEditLead(edit());
    expect(mocks.inserts).toEqual([savedInteraction]);
  });

  it("normalizes a customer reply into an inbound interaction", async () => {
    await logLeadUpdate(log());
    expect(mocks.inserts).toEqual([{ table: "lead_interactions", values: {
      lead_id: id, occurred_at: expect.any(Date), direction: "Inbound",
      interaction_type: "Customer Message", note: null, created_by: owner,
    } }]);
  });

  it("requires a version before opening a transaction", async () => {
    await expect(quickEditLead({ ...edit(), expected_updated_at: undefined })).rejects.toThrow();
    await expect(logLeadUpdate({ ...log(), expected_updated_at: undefined })).rejects.toThrow();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
