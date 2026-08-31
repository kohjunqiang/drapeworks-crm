import { describe, expect, it } from "vitest";
import { leadQuickEditSchema, logUpdateSchema } from "./lead";

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
});
