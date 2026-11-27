import { describe, expect, it } from "vitest";

import { appointmentCreateSchema } from "./appointment";
import { leadBatchSaveSchema } from "./lead-batch";
import { meshOrderDraftSchema } from "./mesh";
import { orderCreateSchema, orderDraftSchema, orderEditSchema } from "./order";

// Cross-flow mobile canonicalisation: the same E.164 value must come out of
// every surface so a lead → appointment → order carries one number.
//
// Component-level behaviour (country inference, no-dirty-on-select) lives in
// src/lib/phone.test.ts.

const MINIMAL_ORDER = {
  customer: { name: "Tan Wei Ming", mobile: "9123 4567" },
  order: { site_address: "12 Lynwood Grove, Singapore 358172" },
  rooms: [
    {
      type: "Living Room",
      label: "Living Room",
      position: 0,
      windows: [{ variant: "regular", position: 0 }],
    },
  ],
};

const withMobile = (mobile: string) => ({
  ...MINIMAL_ORDER,
  customer: { ...MINIMAL_ORDER.customer, mobile },
});

describe("order schemas — mobile canonicalisation", () => {
  it.each([
    ["9123 4567", "+6591234567"],
    ["+65 9123 4567", "+6591234567"],
    ["+60 12 345 6789", "+60123456789"],
    ["0086 138 1234 5678", "+8613812345678"],
  ])("stores %s as %s on create", (mobile, expected) => {
    expect(orderCreateSchema.parse(withMobile(mobile)).customer.mobile).toBe(expected);
  });

  it("stores the canonical value on edit too", () => {
    expect(orderEditSchema.parse(withMobile("+60 12 345 6789")).customer.mobile).toBe("+60123456789");
  });

  it.each([
    "12345",
    "12345678",           // SG-shaped length but wrong leading digit
    "+6512345678",        // same, with explicit +65
    "0123456789",         // foreign national with no country hint
    "60123456789",        // 11 digits — not a possible SG number
    "abc",
    "+",
    "+0 1234567",
    "+1234567890123456",
  ])("rejects %s with an actionable error", (mobile) => {
    const result = orderCreateSchema.safeParse(withMobile(mobile));
    expect(result.success).toBe(false);
  });

  it("keeps the extension rather than dropping it", () => {
    const parsed = orderCreateSchema.parse(withMobile("+1 555 123 4567 ext. 89"));
    expect(parsed.customer.mobile).toContain("+15551234567");
    expect(parsed.customer.mobile).toContain("89");
  });
});

describe("draft schemas — relaxed mobile", () => {
  it("canonicalises a readable draft mobile, keeps blank blank", () => {
    const draft = (mobile?: string) =>
      orderDraftSchema.parse({ customer: { name: "Tan" , mobile }, order: {}, rooms: [] });
    expect(draft("9123 4567").customer.mobile).toBe("+6591234567");
    expect(draft("").customer.mobile).toBe("");
    expect(draft(undefined).customer.mobile).toBe("");
  });

  it("keeps an unparseable draft mobile verbatim", () => {
    const draft = orderDraftSchema.parse({ customer: { name: "Tan", mobile: "call later" }, order: {}, rooms: [] });
    expect(draft.customer.mobile).toBe("call later");
  });

  it("applies the same relaxed rules to mesh drafts", () => {
    const draft = meshOrderDraftSchema.parse({ customer: { name: "Tan", mobile: "+60 12 345 6789" }, order: {}, rooms: [] });
    expect(draft.customer.mobile).toBe("+60123456789");
  });
});

describe("lead batch patch — mobile", () => {
  const patch = (patch: Record<string, unknown>) => ({
    leads: [
      { id: crypto.randomUUID(), expected_updated_at: "2026-11-01T00:00:00Z", patch },
    ],
  });

  it("canonicalises a readable number", () => {
    const parsed = leadBatchSaveSchema.parse(patch({ mobile: "9123 4567" }));
    expect(parsed.leads[0].patch.mobile).toBe("+6591234567");
  });

  it("keeps an unparseable value verbatim", () => {
    const parsed = leadBatchSaveSchema.parse(patch({ mobile: "office line" }));
    expect(parsed.leads[0].patch.mobile).toBe("office line");
  });

  it("clears to null on empty and omits an untouched field", () => {
    expect(leadBatchSaveSchema.parse(patch({ mobile: "" })).leads[0].patch.mobile).toBeNull();
    expect(leadBatchSaveSchema.parse(patch({ name: "Renamed" })).leads[0].patch.mobile).toBeUndefined();
  });
});

describe("appointment new customer — mobile", () => {
  const booking = (mobile: string) => ({
    lead_id: crypto.randomUUID(),
    consultant_id: crypto.randomUUID(),
    date: "2026-09-08",
    time: "14:00",
    address: "12 Lynwood Grove, Singapore 358172",
    customer: { mode: "new" as const, name: "Bren", mobile },
  });

  it("stays required and canonicalises readable numbers", () => {
    expect(appointmentCreateSchema.safeParse(booking("")).success).toBe(false);
    const parsed = appointmentCreateSchema.parse(booking("+60 12 345 6789"));
    expect(parsed.customer.mode === "new" && parsed.customer.mobile).toBe("+60123456789");
    const national = appointmentCreateSchema.parse(booking("9123 4567"));
    expect(national.customer.mode === "new" && national.customer.mobile).toBe("+6591234567");
  });
});
