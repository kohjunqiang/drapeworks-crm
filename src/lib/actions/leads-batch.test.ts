import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(), revalidatePath: vi.fn(), transaction: vi.fn(),
  selectFrom: vi.fn(), updateTable: vi.fn(), insertInto: vi.fn(),
  updateWhere: vi.fn(), set: vi.fn(),
  rows: {} as Record<string, Record<string, unknown>>,
  updates: [] as Record<string, unknown>[],
  updateResult: { id: "x" } as { id: string } | undefined,
  inserts: [] as { table: string; values: Record<string, unknown> }[],
}));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: mocks.requireRole }));
vi.mock("@/lib/db/kysely", () => ({ db: { transaction: mocks.transaction, selectFrom: mocks.selectFrom } }));

import { getLeadBatchEditData, saveLeadBatch } from "./leads-batch";

const idA = "00000000-0000-4000-8000-00000000000a";
const idB = "00000000-0000-4000-8000-00000000000b";
const idC = "00000000-0000-4000-8000-00000000000c";
const owner = "00000000-0000-4000-8000-000000000002";
const version = "2026-08-31T10:00:00.123Z";

const row = (id: string, over: Record<string, unknown> = {}) => ({
  id, updated_at: new Date(version), is_archived: false,
  name: "Customer", funnel_stage: "Qualify Lead", closure_reason: null,
  last_outcome: null, next_action_date_text: null, move_in_date_text: null,
  action_detail: null, mobile: null, development: null, inbound_outbound: null,
  contact_channel: "Other", source: null, primary_product: null, keys_collected: null,
  interaction_summary: null, quotation_breakdown: null, historical_summary: null,
  latest_quote_note: null, renovation_buying_stage: null, engagement_quality: null,
  latest_quote_cents: null, assigned_consultant_id: owner, owner_id: owner,
  ...over,
});
const item = (id: string, patch: Record<string, unknown>, expected = version) =>
  ({ id, expected_updated_at: expected, patch });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rows = { [idA]: row(idA), [idB]: row(idB, { name: "Other" }) };
  mocks.updates = [];
  mocks.updateResult = undefined;
  mocks.inserts = [];
  mocks.requireRole.mockResolvedValue({ user: { id: owner } });
  let requestedIds: string[] | null = null;
  const select = {
    select: vi.fn().mockReturnThis(),
    where: vi.fn((...args: unknown[]) => { if (args[0] === "id" && args[1] === "in") requestedIds = args[2] as string[]; return select; }),
    orderBy: vi.fn().mockReturnThis(), forUpdate: vi.fn().mockReturnThis(),
    execute: vi.fn(async () => Object.values(mocks.rows).filter(row => !requestedIds || requestedIds.includes(row.id as string))),
    executeTakeFirstOrThrow: vi.fn(async () => mocks.rows[idA]),
  };
  mocks.selectFrom.mockReturnValue(select);
  mocks.updateTable.mockImplementation(() => {
    const builder: Record<string, unknown> = {};
    const chain = {
      set: (set: Record<string, unknown>) => { builder.set = set; mocks.set(set); return chain; },
      where: (...args: unknown[]) => { mocks.updateWhere(...args); return chain; },
      returning: () => chain,
      executeTakeFirst: async () => mocks.updateResult ?? { id: builder.id as string },
    };
    mocks.updates.push(builder);
    return chain;
  });
  mocks.insertInto.mockImplementation((table: string) => ({
    values: (values: Record<string, unknown>) => {
      mocks.inserts.push({ table, values });
      return { execute: vi.fn().mockResolvedValue([]) };
    },
  }));
  mocks.transaction.mockReturnValue({ execute: (callback: (trx: unknown) => Promise<unknown>) =>
    callback({ selectFrom: mocks.selectFrom, updateTable: mocks.updateTable, insertInto: mocks.insertInto }),
  });
});

describe("saveLeadBatch", () => {
  it("saves different fields on different leads in one transaction and preserves untouched fields", async () => {
    const result = await saveLeadBatch({ leads: [
      item(idA, { name: "Renamed A" }),
      item(idB, { mobile: "9123 4567", next_action_date: "2026-12-01" }),
    ] });
    expect(result).toEqual({ ok: true, saved: [idA, idB], skipped: [] });
    expect(mocks.updates).toHaveLength(2);
    expect(mocks.updates[0].set).toMatchObject({ name: "Renamed A" });
    expect(mocks.updates[1].set).toMatchObject({ mobile: "9123 4567", next_action_date: "2026-12-01" });
    for (const update of mocks.updates) {
      expect(update.set).toHaveProperty("updated_at");
      expect(update.set).not.toHaveProperty("funnel_stage");
      expect(update.set).not.toHaveProperty("closure_reason");
      expect(update.set).not.toHaveProperty("lead_status");
    }
    // One non-contact audit note per changed lead, no stage events.
    expect(mocks.inserts).toEqual([
      { table: "lead_interactions", values: expect.objectContaining({ lead_id: idA, direction: null, interaction_type: "Note" }) },
      { table: "lead_interactions", values: expect.objectContaining({ lead_id: idB, direction: null, interaction_type: "Note" }) },
    ]);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/leads");
  });

  it("skips an unchanged selected lead without timestamp or audit writes", async () => {
    const result = await saveLeadBatch({ leads: [item(idA, { name: "Customer" })] });
    expect(result).toEqual({ ok: true, saved: [], skipped: [idA] });
    expect(mocks.updateTable).not.toHaveBeenCalled();
    expect(mocks.insertInto).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("does not block an unchanged legacy closed lead that is missing its reason", async () => {
    mocks.rows[idA] = row(idA, { funnel_stage: "Lost", closure_reason: null });
    const result = await saveLeadBatch({ leads: [
      item(idA, { funnel_stage: "Lost", closure_reason: "" }),
      item(idB, { mobile: "9888 7777" }),
    ] });
    expect(result).toEqual({ ok: true, saved: [idB], skipped: [idA] });
    expect(mocks.updates).toHaveLength(1);
  });

  it("requires an effective closure reason when a changed lead is terminal", async () => {
    mocks.rows[idA] = row(idA, { funnel_stage: "Lost", closure_reason: null });
    const result = await saveLeadBatch({ leads: [
      item(idA, { mobile: "9999 0000" }),
      item(idB, { mobile: "9888 7777" }),
    ] });
    expect(result).toMatchObject({ ok: false, errors: [{ leadId: idA, field: "closure_reason", kind: "validation" }] });
    expect(mocks.updateTable).not.toHaveBeenCalled();
    expect(mocks.insertInto).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("requires a closure reason when moving into a terminal stage and accepts a valid one", async () => {
    const rejected = await saveLeadBatch({ leads: [item(idA, { funnel_stage: "Lost" })] });
    expect(rejected).toMatchObject({ ok: false, errors: [{ leadId: idA, field: "closure_reason" }] });
    const accepted = await saveLeadBatch({ leads: [item(idA, { funnel_stage: "Not Qualified", closure_reason: "Ghosted" })] });
    expect(accepted).toEqual({ ok: true, saved: [idA], skipped: [] });
    expect(mocks.updates[0].set).toMatchObject({ funnel_stage: "Not Qualified", closure_reason: "Ghosted" });
  });

  it("clears text fields explicitly sent as empty", async () => {
    mocks.rows[idA] = row(idA, { action_detail: "Call Friday" });
    await saveLeadBatch({ leads: [item(idA, { action_detail: "" })] });
    expect(mocks.updates[0].set).toMatchObject({ action_detail: null });
  });

  it("writes exactly one stage event for a real transition and resets dismissed recommendations", async () => {
    await saveLeadBatch({ leads: [item(idA, { funnel_stage: "Book Appointment" })] });
    expect(mocks.updates[0].set).toHaveProperty("dismissed_recommendations");
    expect(mocks.inserts.filter(entry => entry.table === "lead_stage_events")).toEqual([
      { table: "lead_stage_events", values: expect.objectContaining({
        lead_id: idA, from_stage: "Qualify Lead", to_stage: "Book Appointment", source: "user", changed_by: owner,
      }) },
    ]);
  });

  it("saves a manual Won transition with an attributed stage event", async () => {
    const result = await saveLeadBatch({ leads: [item(idA, { funnel_stage: "Won" })] });
    expect(result).toEqual({ ok: true, saved: [idA], skipped: [] });
    expect(mocks.updates[0].set).toMatchObject({ funnel_stage: "Won" });
    expect(mocks.inserts.filter(entry => entry.table === "lead_stage_events")).toEqual([
      { table: "lead_stage_events", values: expect.objectContaining({
        lead_id: idA, from_stage: "Qualify Lead", to_stage: "Won", source: "user", changed_by: owner,
      }) },
    ]);
  });

  it("still writes nothing across the batch when a manual Won is mixed with a stale row", async () => {
    mocks.rows[idB] = row(idB, { updated_at: new Date("2026-09-01T09:00:00.000Z") });
    const result = await saveLeadBatch({ leads: [
      item(idA, { funnel_stage: "Won" }),
      item(idB, { mobile: "9888 7777" }),
    ] });
    expect(result).toMatchObject({ ok: false, errors: [{ leadId: idB, kind: "conflict" }] });
    expect(mocks.updateTable).not.toHaveBeenCalled();
    expect(mocks.insertInto).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("keeps an already-Won lead Won while saving unrelated fields", async () => {
    mocks.rows[idA] = row(idA, { funnel_stage: "Won" });
    const result = await saveLeadBatch({ leads: [item(idA, { funnel_stage: "Won", mobile: "8111 2222" })] });
    expect(result).toEqual({ ok: true, saved: [idA], skipped: [] });
    expect(mocks.updates[0].set).not.toHaveProperty("funnel_stage");
    expect(mocks.inserts.every(entry => entry.table !== "lead_stage_events")).toBe(true);
  });

  it("returns a conflict with the latest snapshot and writes nothing when any row is stale", async () => {
    mocks.rows[idB] = row(idB, { updated_at: new Date("2026-09-01T09:00:00.000Z"), name: "Newer name" });
    const result = await saveLeadBatch({ leads: [
      item(idA, { name: "Renamed A" }),
      item(idB, { mobile: "9888 7777" }),
    ] });
    expect(result).toMatchObject({ ok: false, errors: [{ leadId: idB, kind: "conflict", latest: expect.objectContaining({ name: "Newer name" }) }] });
    expect(mocks.updateTable).not.toHaveBeenCalled();
    expect(mocks.insertInto).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects archived and missing leads without writing", async () => {
    mocks.rows[idA] = row(idA, { is_archived: true });
    const result = await saveLeadBatch({ leads: [
      item(idA, { name: "Renamed" }),
      item(idC, { name: "Ghost" }),
    ] });
    expect(result).toMatchObject({ ok: false, errors: [
      { leadId: idA, kind: "archived" },
      { leadId: idC, kind: "missing" },
    ] });
    expect(mocks.updateTable).not.toHaveBeenCalled();
  });

  it("syncs the assigned consultant when the owner changes", async () => {
    await saveLeadBatch({ leads: [item(idA, { owner_id: idB })] });
    expect(mocks.updates[0].set).toMatchObject({ owner_id: idB, assigned_consultant_id: idB });
  });

  it("stores the quote in integer cents", async () => {
    await saveLeadBatch({ leads: [item(idA, { latest_quote_sgd: "1450.25" })] });
    expect(mocks.updates[0].set).toMatchObject({ latest_quote_cents: 145025 });
    expect(mocks.updates[0].set).not.toHaveProperty("latest_quote_sgd");
  });

  it("guards the versioned update with the millisecond-truncated timestamp predicate", async () => {
    await saveLeadBatch({ leads: [item(idA, { name: "Renamed" })] });
    expect(mocks.updateWhere).toHaveBeenNthCalledWith(1, "id", "=", idA);
    const predicate = mocks.updateWhere.mock.calls[1][0] as { toOperationNode(): { sqlFragments: string[]; parameters: { value: unknown }[] } };
    const node = predicate.toOperationNode();
    expect(node.sqlFragments.join("")).toContain("date_trunc('milliseconds', updated_at)");
    expect(node.parameters[0].value).toEqual(new Date(version));
  });

  it("rejects forged calculated keys before opening a transaction with a per-lead error", async () => {
    const result = await saveLeadBatch({ leads: [item(idA, { name: "Renamed", lead_status: "Closed – Won", priority_score: 99 })] });
    expect(result).toMatchObject({ ok: false, errors: [{ kind: "validation" }] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].leadId === "" || result.errors[0].leadId === idA).toBe(true);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.updateTable).not.toHaveBeenCalled();
  });

  it("rejects duplicate lead ids and oversized batches before opening a transaction", async () => {
    const dupes = await saveLeadBatch({ leads: [item(idA, { name: "A" }), item(idA, { name: "B" })] });
    expect(dupes).toMatchObject({ ok: false, errors: [{ kind: "validation" }] });
    const oversized = await saveLeadBatch({ leads: Array.from({ length: 51 }, (_, index) => item(`00000000-0000-4000-8000-0000000001${String(index).padStart(2, "0")}`, { name: "X" })) });
    expect(oversized).toMatchObject({ ok: false, errors: [{ kind: "validation" }] });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("maps field validation failures to the offending lead and field without writing", async () => {
    const result = await saveLeadBatch({ leads: [
      item(idA, { name: "" }),
      item(idB, { next_action_date: "2026-13-40" }),
    ] });
    expect(result).toMatchObject({ ok: false, errors: [
      { leadId: idA, kind: "validation", field: "name" },
      { leadId: idB, kind: "validation", field: "next_action_date" },
    ] });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("reports an invalid date or out-of-range quote as a definitive no-write error", async () => {
    const result = await saveLeadBatch({ leads: [item(idA, { latest_quote_sgd: "abc" })] });
    expect(result).toMatchObject({ ok: false, errors: [{ leadId: idA, kind: "validation", field: "latest_quote_sgd" }] });
    const oversized = await saveLeadBatch({ leads: [item(idA, { latest_quote_sgd: "2000000" })] });
    expect(oversized).toMatchObject({ ok: false, errors: [{ leadId: idA, kind: "validation", field: "latest_quote_sgd" }] });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("roundtrips multiline action detail and clears it on explicit empty", async () => {
    const multiline = "First line\nSecond line\n\nFourth";
    await saveLeadBatch({ leads: [item(idA, { action_detail: multiline })] });
    expect(mocks.updates[0].set).toMatchObject({ action_detail: multiline });
  });

  it("propagates the role guard before opening a transaction", async () => {
    mocks.requireRole.mockRejectedValue(new Error("forbidden"));
    await expect(saveLeadBatch({ leads: [item(idA, { name: "Renamed" })] })).rejects.toThrow("forbidden");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});

describe("getLeadBatchEditData", () => {
  it("returns the latest editable values with a serialized version timestamp", async () => {
    const result = await getLeadBatchEditData({ lead_ids: [idA] });
    expect(result.leads).toEqual([expect.objectContaining({
      id: idA, updated_at: new Date(version).toISOString(), name: "Customer",
    })]);
    expect(mocks.requireRole).toHaveBeenCalledWith(["consultant", "admin"]);
  });
});
