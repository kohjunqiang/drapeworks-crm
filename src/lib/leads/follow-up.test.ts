import { describe, expect, it } from "vitest";

import { leadFollowUpLabel } from "@/lib/leads/follow-up";
import { addDays } from "@/lib/leads/sg-date";

const TODAY = "2026-11-28";
// SG noon on a given calendar date — toSgDate() of this instant is the date.
const attendedOn = (sgDate: string) => new Date(`${sgDate}T12:00:00+08:00`);
const attendedDaysAgo = (n: number) => attendedOn(addDays(TODAY, -n));

const label = (args: Partial<Parameters<typeof leadFollowUpLabel>[0]>) =>
  leadFollowUpLabel({
    funnelStage: "Send Quotation",
    isArchived: false,
    lastCompletedAt: null,
    today: TODAY,
    ...args,
  });

describe("leadFollowUpLabel thresholds", () => {
  it.each([
    [1, "Follow-up 1 due"],
    [3, "Follow-up 1 due"],
    [4, "Follow-up 2 due"],
    [6, "Follow-up 2 due"],
    [7, "Follow-up 3 due"],
    [14, "Follow-up 3 due"],
    [15, "Follow-up 4 due"],
    [29, "Follow-up 4 due"],
    [30, "Follow-up 5 due"],
    [45, "Follow-up 5 due"],
  ])("day %i → %s", (days, expected) => {
    expect(label({ lastCompletedAt: attendedDaysAgo(days) })).toBe(expected);
  });
});

describe("leadFollowUpLabel suppression", () => {
  it("shows nothing for a same-day (day 0) appointment", () => {
    expect(label({ lastCompletedAt: attendedOn(TODAY) })).toBeNull();
  });

  it("shows nothing for a future-dated appointment", () => {
    expect(
      label({ lastCompletedAt: attendedOn(addDays(TODAY, 1)) }),
    ).toBeNull();
  });

  it("shows nothing with no attended appointment", () => {
    expect(label({ lastCompletedAt: null })).toBeNull();
  });

  it.each(["Won", "Lost"] as const)("hides %s leads", (funnelStage) => {
    expect(
      label({ funnelStage, lastCompletedAt: attendedDaysAgo(10) }),
    ).toBeNull();
  });

  it("hides archived leads", () => {
    expect(
      label({ isArchived: true, lastCompletedAt: attendedDaysAgo(10) }),
    ).toBeNull();
  });

  it("keeps the label on Not Qualified — only Won/Lost/archived are excluded", () => {
    expect(
      label({ funnelStage: "Not Qualified", lastCompletedAt: attendedDaysAgo(10) }),
    ).toBe("Follow-up 3 due");
  });
});
