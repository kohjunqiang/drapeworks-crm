import { describe, expect, it } from "vitest";
import { selectedFilters, validFilterDate } from "./workspace-filters";

describe("Workspace applied filters", () => {
  it("does not claim invalid filters are applied", () => {
    expect(selectedFilters({ stage: "invalid", owner: "missing", due: "nope", created_from: "2026-02-30" }, [])).toEqual([]);
  });
  it("shows direction, stage, outcome, action and due selections", () => {
    expect(selectedFilters({ direction: "Inbound", stage: "Qualify Lead", outcome: "Customer Replied", action: "Reply Required", due: "Overdue" }, []).map(filter => filter.key)).toEqual(["direction", "stage", "outcome", "action", "due"]);
  });
  it("shows every date range boundary independently", () => {
    const params = Object.fromEntries(["created", "initiated", "contact", "next"].flatMap(key => [[`${key}_from`, "2026-08-01"], [`${key}_to`, "2026-08-31"]]));
    expect(selectedFilters(params, [])).toHaveLength(8);
  });
  it("labels ownership and text filters", () => {
    expect(selectedFilters({ owner: "one", detail: " Call back ", q: " Jane " }, [{ id: "one", full_name: "Owner One" }]).map(filter => filter.label)).toEqual(["Search: Jane", "Action Detail: Call back", "Owner: Owner One"]);
  });
  it.each(["2026-02-30", "2026-13-01", "today", "2026-1-1"])("rejects invalid date %s", value => expect(validFilterDate(value)).toBe(false));
  it("accepts a valid leap date", () => expect(validFilterDate("2028-02-29")).toBe(true));
});
