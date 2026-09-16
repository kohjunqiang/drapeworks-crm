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
  // Lead mobile is deliberately free text — overseas contacts must save
  // verbatim on every path that carries the field.
  it.each(["+60 12 345 6789", "+1 (555) 123-4567", "9123 4567"])("accepts mobile %s on create and both edit paths", mobile => {
    expect(leadCreateSchema.parse({ name: "Lead", contact_channel: "WhatsApp", first_initiated_date: "2026-09-16", mobile }).mobile).toBe(mobile);
    expect(leadDetailsSchema.parse({ id: edit.id, owner_id: edit.owner_id, expected_updated_at: edit.expected_updated_at, mobile }).mobile).toBe(mobile);
    expect(leadQuickEditSchema.parse({ ...edit, mobile }).mobile).toBe(mobile);
  });
});
