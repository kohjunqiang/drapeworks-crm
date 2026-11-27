import { describe, expect, it } from "vitest";

import {
  buildPatch, changedFields, pruneLeadErrors, reapplyChangedValues, valuesFromSnapshot,
  batchContextKey, batchDraftStorageKey, parseStoredDrafts, pruneForeignDraftKeys, BATCH_DRAFT_STORAGE_PREFIX,
  type LeadBatchError, type LeadBatchSnapshot,
} from "./batch-draft";

const snapshot = (over: Partial<LeadBatchSnapshot> = {}): LeadBatchSnapshot => ({
  id: "00000000-0000-4000-8000-000000000001",
  updated_at: "2026-08-31T10:00:00.123Z",
  is_archived: false,
  name: "Jane Tan",
  funnel_stage: "Qualify Lead",
  closure_reason: null,
  last_outcome: "Awaiting Customer",
  next_action_date_text: "2026-12-01",
  move_in_date_text: null,
  action_detail: "Send fabric options",
  mobile: "9123 4567",
  development: null,
  inbound_outbound: "Inbound",
  contact_channel: "Telegram",
  source: "SEM",
  primary_product: "Both",
  keys_collected: true,
  interaction_summary: "Summary",
  quotation_breakdown: null,
  historical_summary: null,
  latest_quote_note: null,
  renovation_buying_stage: "Pre-Keys",
  engagement_quality: "High",
  latest_quote_cents: 145025,
  assigned_consultant_id: "00000000-0000-4000-8000-0000000000aa",
  owner_id: "00000000-0000-4000-8000-0000000000bb",
  ...over,
});

describe("valuesFromSnapshot", () => {
  it("converts stored values into form strings and keeps legacy Both round-trippable", () => {
    const values = valuesFromSnapshot(snapshot());
    expect(values).toMatchObject({
      name: "Jane Tan",
      owner_id: "00000000-0000-4000-8000-0000000000aa",
      funnel_stage: "Qualify Lead",
      last_outcome: "Awaiting Customer",
      next_action_date: "2026-12-01",
      move_in_date: "",
      action_detail: "Send fabric options",
      mobile: "9123 4567",
      development: "",
      inbound_outbound: "Inbound",
      contact_channel: "Telegram",
      source: "SEM",
      primary_product: "Both",
      keys_collected: "true",
      interaction_summary: "Summary",
      renovation_buying_stage: "Pre-Keys",
      engagement_quality: "High",
      latest_quote_sgd: "1450.25",
    });
  });

  it("prefers the assigned consultant over the original owner", () => {
    expect(valuesFromSnapshot(snapshot()).owner_id).toBe("00000000-0000-4000-8000-0000000000aa");
    expect(valuesFromSnapshot(snapshot({ assigned_consultant_id: null })).owner_id).toBe("00000000-0000-4000-8000-0000000000bb");
  });
});

describe("changedFields / buildPatch", () => {
  it("reports nothing when the draft matches the baseline", () => {
    const baseline = valuesFromSnapshot(snapshot());
    expect(changedFields(baseline, { ...baseline })).toEqual([]);
    expect(buildPatch(baseline, { ...baseline })).toEqual({});
  });

  it("sends only changed keys and preserves an explicit clear", () => {
    const baseline = valuesFromSnapshot(snapshot());
    const values = { ...baseline, mobile: "9999 8888", action_detail: "", keys_collected: "" };
    expect(changedFields(baseline, values)).toEqual(["action_detail", "mobile", "keys_collected"]);
    expect(buildPatch(baseline, values)).toEqual({ mobile: "9999 8888", action_detail: "", keys_collected: "" });
    expect(buildPatch(baseline, values)).not.toHaveProperty("name");
  });

  it("roundtrips multiline action detail verbatim", () => {
    const baseline = valuesFromSnapshot(snapshot());
    const multiline = "First line\nSecond line\n\nFourth";
    const values = { ...baseline, action_detail: multiline };
    expect(buildPatch(baseline, values)).toEqual({ action_detail: multiline });
  });
});

describe("reapplyChangedValues (conflict resolution)", () => {
  it("keeps the other editor's untouched-field changes while reapplying our edits", () => {
    // We drafted an Action Detail edit; meanwhile someone else changed mobile.
    const oldBaseline = valuesFromSnapshot(snapshot());
    const ourValues = { ...oldBaseline, action_detail: "Meet on site Tuesday" };
    const latest = valuesFromSnapshot(snapshot({ mobile: "8888 0000", action_detail: "Send fabric options" }));

    const merged = reapplyChangedValues(latest, oldBaseline, ourValues);
    expect(merged.action_detail).toBe("Meet on site Tuesday"); // our edit kept
    expect(merged.mobile).toBe("8888 0000");                   // their change kept
    expect(changedFields(latest, merged)).toEqual(["action_detail"]);
  });

  it("produces a no-op draft when nothing the user changed conflicts", () => {
    const oldBaseline = valuesFromSnapshot(snapshot());
    const ourValues = { ...oldBaseline }; // selected but never edited
    const latest = valuesFromSnapshot(snapshot({ mobile: "8888 0000" }));
    const merged = reapplyChangedValues(latest, oldBaseline, ourValues);
    expect(merged).toEqual(latest);
  });
});

describe("pruneLeadErrors", () => {
  const errors: LeadBatchError[] = [
    { leadId: "a", kind: "validation", field: "name", message: "bad name" },
    { leadId: "a", kind: "validation", field: "mobile", message: "bad mobile" },
    { leadId: "a", kind: "conflict", message: "stale" },
    { leadId: "b", kind: "validation", field: "name", message: "bad name" },
    { leadId: "", kind: "validation", message: "batch-level" },
  ];

  it("removes all of a lead's errors on discard/deselect without touching others", () => {
    expect(pruneLeadErrors(errors, "a")).toEqual([
      { leadId: "b", kind: "validation", field: "name", message: "bad name" },
      { leadId: "", kind: "validation", message: "batch-level" },
    ]);
  });

  it("clears only the corrected field's error and keeps lead-level errors", () => {
    expect(pruneLeadErrors(errors, "a", "name")).toEqual([
      { leadId: "a", kind: "validation", field: "mobile", message: "bad mobile" },
      { leadId: "a", kind: "conflict", message: "stale" },
      { leadId: "b", kind: "validation", field: "name", message: "bad name" },
      { leadId: "", kind: "validation", message: "batch-level" },
    ]);
  });
});

describe("draft storage keys", () => {
  it("scopes storage by actor id and normalized result context", () => {
    const userA = batchDraftStorageKey("user-a", batchContextKey("view=all&status=open"));
    const userB = batchDraftStorageKey("user-b", batchContextKey("view=all&status=open"));
    expect(userA).not.toBe(userB);                     // different users, distinct keys
    expect(userA).toContain("user-a");

    const otherFilter = batchDraftStorageKey("user-a", batchContextKey("view=all&status=closed"));
    const otherView = batchDraftStorageKey("user-a", batchContextKey("view=work&status=open"));
    expect(userA).not.toBe(otherFilter);              // different filters, separate keys
    expect(userA).not.toBe(otherView);                // different views, separate keys

    const page2 = batchDraftStorageKey("user-a", batchContextKey("view=all&status=open&page=2"));
    expect(page2).toBe(userA);                        // pagination shares the context key

    const reordered = batchContextKey("status=open&view=all");
    expect(reordered).toBe(batchContextKey("view=all&status=open")); // normalized order
  });
});

describe("pruneForeignDraftKeys", () => {
  it("removes other actors' stored drafts and keeps ours and unrelated keys", () => {
    const store: Record<string, string> = {
      [`${BATCH_DRAFT_STORAGE_PREFIX}:user-b:view=all`]: "{}",
      [`${BATCH_DRAFT_STORAGE_PREFIX}:user-c:view=work`]: "{}",
      [`${BATCH_DRAFT_STORAGE_PREFIX}:user-a:view=all`]: "{}",
      "unrelated-key": "x",
    };
    const fake = {
      get length() { return Object.keys(store).length; },
      key: (i: number) => Object.keys(store)[i] ?? null,
      removeItem: (k: string) => { delete store[k]; },
    };
    pruneForeignDraftKeys(fake, "user-a");
    expect(Object.keys(store).sort()).toEqual([`${BATCH_DRAFT_STORAGE_PREFIX}:user-a:view=all`, "unrelated-key"]);
  });
});

describe("parseStoredDrafts", () => {
  const now = Date.parse("2026-08-31T12:00:00Z");
  const entry = (id: string) => ({ id, loading: false });
  const stored = (order: string[], extra: Record<string, { id: string; loading?: boolean }> = {}) => JSON.stringify({
    savedAt: now - 1000,
    order,
    entries: Object.fromEntries([...order, ...Object.keys(extra)].map(id => [id, extra[id] ?? entry(id)])),
  });

  it("returns null for missing, malformed, or expired payloads", () => {
    expect(parseStoredDrafts(null, now)).toBeNull();
    expect(parseStoredDrafts("{not json", now)).toBeNull();
    expect(parseStoredDrafts(JSON.stringify({ savedAt: now - 25 * 60 * 60 * 1000, order: ["a"], entries: { a: entry("a") } }), now)).toBeNull();
    expect(parseStoredDrafts(JSON.stringify({ order: ["a"], entries: { a: entry("a") } }), now)).toBeNull(); // no savedAt
  });

  it("keeps valid drafts, drops loading entries and unknown ids, caps at 50", () => {
    const big = Array.from({ length: 60 }, (_, i) => `lead-${i}`);
    const parsed = parseStoredDrafts(stored(big), now);
    expect(parsed?.order).toHaveLength(50);
    expect(Object.keys(parsed?.entries ?? {})).toHaveLength(50);

    const partial = parseStoredDrafts(JSON.stringify({
      savedAt: now - 1000,
      order: ["a", "b", "ghost"],                    // b is loading, ghost has no entry
      entries: { a: entry("a"), b: { id: "b", loading: true } },
    }), now);
    expect(partial?.order).toEqual(["a"]); // loading entry and unknown id pruned
    expect(partial?.entries.a).toEqual(entry("a"));
  });
});
