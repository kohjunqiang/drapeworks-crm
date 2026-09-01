import { describe, expect, it } from "vitest";
import { leadCreateSchema, leadQuickEditSchema } from "./lead";

describe("Lead product choices", () => {
  const newLead = { name: "New lead", contact_channel: "Other", first_initiated_date: "2026-09-01" };
  it("defaults new leads to Qualify Lead", () => {
    expect(leadCreateSchema.parse(newLead).funnel_stage).toBe("Qualify Lead");
  });
  it.each(["Curtains / Blinds", "Mesh"])("allows %s for new leads", primary_product => {
    expect(leadCreateSchema.safeParse({ ...newLead, primary_product }).success).toBe(true);
  });
  it("rejects Both for new leads", () => {
    expect(leadCreateSchema.safeParse({ ...newLead, primary_product: "Both" }).success).toBe(false);
  });
  it("preserves the historical product when editing another field", () => {
    const result = leadQuickEditSchema.parse({ expected_updated_at:new Date().toISOString(), id: crypto.randomUUID(), owner_id: crypto.randomUUID(), name: "Legacy lead", funnel_stage: "Qualify Lead", contact_channel: "Other", source: "", primary_product: "Both", latest_quote_sgd: "" });
    expect(result.primary_product).toBe("Both");
  });
});
