import { describe, expect, it } from "vitest";
import { leadCreateSchema, leadDetailsSchema, leadQuickEditSchema, logUpdateSchema } from "./lead";

const edit = {
  id: crypto.randomUUID(), owner_id: crypto.randomUUID(), name: "Lead",
  expected_updated_at: "2026-08-31T12:00:00.123Z", funnel_stage: "Qualify Lead",
  contact_channel: "Other", source: "", primary_product: "", latest_quote_sgd: "",
};
const interaction = {
  lead_id: edit.id, expected_updated_at: edit.expected_updated_at,
  funnel_stage: "Qualify Lead", last_outcome: "Customer Replied",
  interaction_type: "Customer Message", direction: "Inbound",
};
describe("lead save validation", () => {
  it.each([undefined, "", "not-a-date"])("rejects invalid version %s on both save paths", version => {
    expect(leadQuickEditSchema.safeParse({ ...edit, expected_updated_at: version }).success).toBe(false);
    expect(logUpdateSchema.safeParse({ ...interaction, expected_updated_at: version }).success).toBe(false);
  });
  it("preserves multiline action and quotation notes", () => {
    const result = leadQuickEditSchema.parse({ ...edit, action_detail: "Call customer\nSend options", latest_quote_note: "Curtains\nBlinds" });
    expect(result.action_detail).toBe("Call customer\nSend options");
    expect(result.latest_quote_note).toBe("Curtains\nBlinds");
  });
  it("preserves timestamp precision and accepts a complete interaction", () => {
    expect(logUpdateSchema.parse(interaction).expected_updated_at.toISOString()).toBe(edit.expected_updated_at);
  });
  // Lead mobile is deliberately free text — overseas contacts must save on
  // every path that carries the field. Readable numbers normalise to E.164;
  // anything unparseable is kept verbatim rather than rejected.
  it.each([
    ["+60 12 345 6789", "+60123456789"],
    ["+1 (555) 123-4567", "+15551234567"],
    ["9123 4567", "+6591234567"],
    ["0086 138 1234 5678", "+8613812345678"],
  ])("normalises mobile %s to %s on create and both edit paths", (mobile, expected) => {
    expect(leadCreateSchema.parse({ name: "Lead", contact_channel: "WhatsApp", first_initiated_date: "2026-09-16", mobile }).mobile).toBe(expected);
    expect(leadDetailsSchema.parse({ id: edit.id, owner_id: edit.owner_id, expected_updated_at: edit.expected_updated_at, mobile }).mobile).toBe(expected);
    expect(leadQuickEditSchema.parse({ ...edit, mobile }).mobile).toBe(expected);
  });
  it.each(["call after 6pm", "whatsapp only"])("keeps unparseable mobile %s verbatim on all paths", mobile => {
    expect(leadCreateSchema.parse({ name: "Lead", contact_channel: "WhatsApp", first_initiated_date: "2026-09-16", mobile }).mobile).toBe(mobile);
    expect(leadDetailsSchema.parse({ id: edit.id, owner_id: edit.owner_id, expected_updated_at: edit.expected_updated_at, mobile }).mobile).toBe(mobile);
    expect(leadQuickEditSchema.parse({ ...edit, mobile }).mobile).toBe(mobile);
  });
});
