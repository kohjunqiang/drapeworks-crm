import { describe, expect, it } from "vitest";
import { leadCreateSchema, leadQuickEditSchema } from "./lead";

describe("Lead product choices", () => {
  const newLead = { name: "New lead", contact_channel: "Other", first_initiated_date: "2026-09-01" };
  it("defaults new leads to Qualify Lead", () => {
    expect(leadCreateSchema.parse(newLead).funnel_stage).toBe("Qualify Lead");
  });
  it.each(["Curtains", "Blinds", "Mesh"])("allows %s for new leads", primary_product => {
    expect(leadCreateSchema.safeParse({ ...newLead, primary_product }).success).toBe(true);
  });
  it("allows a blank product for new leads", () => {
    const result = leadCreateSchema.parse({ ...newLead, primary_product: "" });
    expect(result.primary_product).toBeUndefined();
  });
  it.each(["Both", "Curtains / Blinds"])("rejects the legacy %s value for new leads", primary_product => {
    expect(leadCreateSchema.safeParse({ ...newLead, primary_product }).success).toBe(false);
  });
  it("rejects an unknown product for new leads", () => {
    expect(leadCreateSchema.safeParse({ ...newLead, primary_product: "Vinyl" }).success).toBe(false);
  });
  it.each(["Both", "Curtains / Blinds"])("preserves the historical %s product when editing another field", primary_product => {
    const result = leadQuickEditSchema.parse({ expected_updated_at:new Date().toISOString(), id: crypto.randomUUID(), owner_id: crypto.randomUUID(), name: "Legacy lead", funnel_stage: "Qualify Lead", contact_channel: "Other", source: "", primary_product, latest_quote_sgd: "" });
    expect(result.primary_product).toBe(primary_product);
  });
});
