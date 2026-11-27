import { describe, expect, it } from "vitest";

import { FUNNEL_STAGES } from "./funnel-types";
import { bookingBlockedReason } from "./booking";

const OPEN_STAGES = FUNNEL_STAGES.filter(
  (stage) => stage !== "Won" && stage !== "Lost" && stage !== "Not Qualified",
);

describe("bookingBlockedReason", () => {
  it.each(OPEN_STAGES)("allows booking directly from %s without a stage save", (funnel_stage) => {
    expect(bookingBlockedReason({ funnel_stage, is_archived: false })).toBeNull();
  });

  it.each(["Won", "Lost", "Not Qualified"] as const)(
    "blocks a %s lead with an explanation instead of reopening it",
    (funnel_stage) => {
      const reason = bookingBlockedReason({ funnel_stage, is_archived: false });
      expect(reason).toContain(funnel_stage);
      expect(reason).toContain("Reopen");
    },
  );

  it("blocks an archived lead even at an open stage", () => {
    expect(bookingBlockedReason({ funnel_stage: "Qualify Lead", is_archived: true })).toMatch(/archived/);
  });

  it("keeps blocking an archived closed lead", () => {
    expect(bookingBlockedReason({ funnel_stage: "Lost", is_archived: true })).toBeTruthy();
  });
});
