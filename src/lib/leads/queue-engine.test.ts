import { describe, expect, it } from "vitest";

import { addDays } from "./sg-date";
import {
  compareQueueRows,
  deriveActionRequired,
  deriveContactPriority,
  deriveDueStatus,
  deriveEffectiveActionDate,
  deriveLead,
  deriveNextAction,
  deriveQueueVisibility,
} from "./queue-engine";
import type { LeadEngineInput } from "./types";

function lead(over: Partial<LeadEngineInput> = {}): LeadEngineInput {
  return {
    funnel_stage: "New Lead",
    lead_status: "Active",
    last_outcome: null,
    action_detail_override: null,
    action_date: null,
    last_customer_response_at: null,
    ...over,
  };
}

describe("deriveActionRequired", () => {
  it("closes Won and Lost before anything else is considered", () => {
    // Outcome would otherwise say 'Reply Required' — stage wins here.
    expect(
      deriveActionRequired(
        lead({ funnel_stage: "Won", last_outcome: "Customer Replied" }),
      ),
    ).toBe("Closed");
    expect(deriveActionRequired(lead({ funnel_stage: "Lost" }))).toBe("Closed");
  });

  it("ignores Not Qualified leads and leads flagged Ignore", () => {
    expect(deriveActionRequired(lead({ funnel_stage: "Not Qualified" }))).toBe(
      "Ignore Lead",
    );
    expect(deriveActionRequired(lead({ lead_status: "Ignore" }))).toBe(
      "Ignore Lead",
    );
  });

  it("lets the outcome override the funnel stage", () => {
    // The documented rule: the ball is with Drapeworks, so the stage does not
    // matter. A Quote Sent lead that replied needs a reply, not a follow-up.
    expect(
      deriveActionRequired(
        lead({ funnel_stage: "Quote Sent", last_outcome: "Customer Replied" }),
      ),
    ).toBe("Reply Required");
  });

  it.each([
    ["Appointment Confirmed", "Attend / Confirm Appointment"],
    ["Barrier / Objection Raised", "Resolve Barrier"],
    ["Customer Needs Time", "Nurture / Re-engage"],
    ["No Response", "Follow Up – No Response"],
    ["Ready to Book Appointment", "Book Appointment"],
    ["Customer Replied", "Reply Required"],
  ] as const)("maps outcome %s to %s", (outcome, expected) => {
    expect(
      deriveActionRequired(
        lead({ funnel_stage: "Decision Pending", last_outcome: outcome }),
      ),
    ).toBe(expected);
  });

  it.each([
    ["Nurture", "Nurture / Re-engage"],
    ["New Lead", "Qualify Lead"],
    ["Qualified / Pre-Appointment", "Book Appointment"],
    ["Appointment Booked", "Attend / Confirm Appointment"],
    ["Post-Appointment / Quote Pending", "Send Quote"],
    ["Quote Sent", "Follow Up Quote"],
    ["Decision Pending", "Push for Decision"],
  ] as const)("maps stage %s to %s when no outcome branch hits", (stage, expected) => {
    expect(
      deriveActionRequired(
        lead({ funnel_stage: stage, last_outcome: "Follow-Up Sent" }),
      ),
    ).toBe(expected);
  });

  it("falls through to Review Lead when nothing matches", () => {
    // UNREACHABLE IN PRODUCTION, and the `as never` cast below is the tell.
    // All ten funnel_stage values have a branch, and the column is a NOT NULL
    // enum — Postgres cannot produce a stage this function does not handle.
    // Excel could, from a blank cell. Kept because the branch exists in the
    // formula being ported, and because deleting it would make the cascade
    // non-total if a stage is ever added.
    expect(
      deriveActionRequired(
        lead({ funnel_stage: "Quote Requested" as never, last_outcome: null }),
      ),
    ).toBe("Review Lead");
  });
});

describe("deriveNextAction", () => {
  it.each([
    ["Reply Required", "Reply to latest customer message"],
    ["Qualify Lead", "Establish need, timing and property details"],
    ["Book Appointment", "Offer 2 consultation slots"],
    ["Attend / Confirm Appointment", "Confirm / attend consultation"],
    ["Send Quote", "Prepare and send quotation"],
    ["Follow Up Quote", "Follow up on quotation and ask for decision"],
    ["Push for Decision", "Resolve barrier and ask for commitment"],
    [
      "Nurture / Re-engage",
      "Re-engage at the appropriate key / renovation timing",
    ],
    [
      "Follow Up – No Response",
      "Send a value-adding follow-up / reactivation",
    ],
  ] as const)("gives %s the phrase %s", (action, expected) => {
    expect(deriveNextAction(action, null)).toBe(expected);
  });

  it("lets a manual override win over the derived phrase", () => {
    expect(
      deriveNextAction("Book Appointment", "Call after 7pm, works shifts"),
    ).toBe("Call after 7pm, works shifts");
  });

  it("returns an empty instruction for Resolve Barrier — a spreadsheet bug, ported deliberately", () => {
    // Column I branch 4 emits 'Resolve Barrier' but column K has no case for
    // it, so Alan sees a blank instruction. Reproduced so the import diff in
    // scripts/verify-lead-engine.ts can pass. Fixing it is a follow-up phase.
    expect(deriveNextAction("Resolve Barrier", null)).toBe("");
  });

  it("returns an empty instruction for Closed, Ignore Lead and Review Lead", () => {
    expect(deriveNextAction("Closed", null)).toBe("");
    expect(deriveNextAction("Ignore Lead", null)).toBe("");
    expect(deriveNextAction("Review Lead", null)).toBe("");
  });
});

const TODAY = "2026-08-22";

describe("deriveEffectiveActionDate", () => {
  it("has no date when the action is Closed", () => {
    expect(deriveEffectiveActionDate("Closed", "2026-08-30", TODAY)).toBeNull();
  });

  it("uses the manual action date when one is set", () => {
    expect(
      deriveEffectiveActionDate("Book Appointment", "2026-08-30", TODAY),
    ).toBe("2026-08-30");
  });

  it("defaults Reply Required and Send Quote to today", () => {
    expect(deriveEffectiveActionDate("Reply Required", null, TODAY)).toBe(TODAY);
    expect(deriveEffectiveActionDate("Send Quote", null, TODAY)).toBe(TODAY);
  });

  it("has no date for any other action without a manual date", () => {
    expect(deriveEffectiveActionDate("Qualify Lead", null, TODAY)).toBeNull();
  });

  it("still resolves a date for Ignore Lead — only Closed is excluded here", () => {
    // Column M's guard is narrower than column N's. Ported as-is.
    expect(deriveEffectiveActionDate("Ignore Lead", "2026-08-30", TODAY)).toBe(
      "2026-08-30",
    );
  });
});

describe("deriveDueStatus", () => {
  it("reports Closed for both Closed and Ignore Lead", () => {
    expect(deriveDueStatus("Closed", "2026-08-30", TODAY)).toBe("Closed");
    expect(deriveDueStatus("Ignore Lead", "2026-08-30", TODAY)).toBe("Closed");
  });

  it("asks for a date when there is none", () => {
    expect(deriveDueStatus("Qualify Lead", null, TODAY)).toBe("Schedule Date");
  });

  it("classifies past, present and future", () => {
    expect(deriveDueStatus("Qualify Lead", "2026-08-21", TODAY)).toBe("Overdue");
    expect(deriveDueStatus("Qualify Lead", "2026-08-22", TODAY)).toBe("Due Today");
    expect(deriveDueStatus("Qualify Lead", "2026-08-23", TODAY)).toBe("Upcoming");
  });
});

describe("deriveContactPriority", () => {
  it("closes Won, Lost and Closed", () => {
    expect(deriveContactPriority(lead({ funnel_stage: "Won" }), "Closed", null, TODAY)).toBe("Closed");
    expect(deriveContactPriority(lead({ funnel_stage: "Lost" }), "Closed", null, TODAY)).toBe("Closed");
  });

  it("puts Reply Required and Send Quote at the top regardless of date", () => {
    // Even a date three weeks out cannot push these down: the customer is waiting.
    expect(
      deriveContactPriority(lead(), "Reply Required", "2026-09-30", TODAY),
    ).toBe("Contact Today");
    expect(
      deriveContactPriority(lead(), "Send Quote", "2026-09-30", TODAY),
    ).toBe("Contact Today");
  });

  it("bands by the effective date when one exists", () => {
    expect(deriveContactPriority(lead(), "Qualify Lead", "2026-08-20", TODAY)).toBe("Contact Today");
    expect(deriveContactPriority(lead(), "Qualify Lead", "2026-08-22", TODAY)).toBe("Contact Today");
    expect(deriveContactPriority(lead(), "Qualify Lead", "2026-08-25", TODAY)).toBe("Contact in 2–3 Days");
    expect(deriveContactPriority(lead(), "Qualify Lead", "2026-08-29", TODAY)).toBe("Contact Within 7 Days");
    expect(deriveContactPriority(lead(), "Qualify Lead", "2026-08-30", TODAY)).toBe("Future / Nurture");
  });

  it("bands by action when there is no date", () => {
    expect(deriveContactPriority(lead(), "Nurture / Re-engage", null, TODAY)).toBe("Future / Nurture");
    expect(deriveContactPriority(lead(), "Attend / Confirm Appointment", null, TODAY)).toBe("Contact Today");
    expect(deriveContactPriority(lead(), "Book Appointment", null, TODAY)).toBe("Contact in 2–3 Days");
    expect(deriveContactPriority(lead(), "Push for Decision", null, TODAY)).toBe("Contact in 2–3 Days");
  });

  it("falls Ignore Lead through to Contact Within 7 Days — a spreadsheet bug, ported deliberately", () => {
    // This is half of known bug #1: an Ignore Lead that is still Active gets a
    // live priority here, and the visibility rule only excludes Unresponsive.
    // One such lead sits in the real queue today.
    expect(deriveContactPriority(lead(), "Ignore Lead", null, TODAY)).toBe(
      "Contact Within 7 Days",
    );
  });
});

describe("deriveQueueVisibility", () => {
  it("excludes Won, Lost and Closed as Closed", () => {
    expect(deriveQueueVisibility(lead({ funnel_stage: "Won" }), "Closed", TODAY)).toBe("Exclude – Closed");
  });

  it("excludes Unresponsive leads as Ghosted", () => {
    expect(
      deriveQueueVisibility(lead({ lead_status: "Unresponsive" }), "Qualify Lead", TODAY),
    ).toBe("Exclude – Ghosted");
  });

  it("excludes non-Nurture leads whose last customer response is over 90 days old", () => {
    expect(
      deriveQueueVisibility(
        lead({ last_customer_response_at: "2026-05-01" }),
        "Qualify Lead",
        TODAY,
      ),
    ).toBe("Exclude – Stale 90d+");
  });

  it("keeps a lead whose last response is exactly 90 days old", () => {
    // The rule is a strict `<`, so the 90th day is the last one that counts as
    // fresh. Pinned because 56 real leads sit near this boundary and a slip to
    // `<=` would only surface at the Task 12 parity gate.
    expect(
      deriveQueueVisibility(
        lead({ last_customer_response_at: addDays(TODAY, -90) }),
        "Qualify Lead",
        TODAY,
      ),
    ).toBe("Include");
  });

  it("excludes a lead whose last response is 91 days old", () => {
    expect(
      deriveQueueVisibility(
        lead({ last_customer_response_at: addDays(TODAY, -91) }),
        "Qualify Lead",
        TODAY,
      ),
    ).toBe("Exclude – Stale 90d+");
  });

  it("keeps a Nurture lead however stale it is", () => {
    // Waiting on keys or renovation is not ghosting.
    expect(
      deriveQueueVisibility(
        lead({ funnel_stage: "Nurture", last_customer_response_at: "2024-01-01" }),
        "Nurture / Re-engage",
        TODAY,
      ),
    ).toBe("Include");
  });

  it("keeps a lead that has never responded — the stale rule needs a date to bite", () => {
    expect(
      deriveQueueVisibility(lead({ last_customer_response_at: null }), "Qualify Lead", TODAY),
    ).toBe("Include");
  });

  it("keeps an active Not Qualified lead — a spreadsheet bug, ported deliberately", () => {
    // Known bug #1 in full: Ignore Lead gets a live priority (Task 9) and the
    // visibility rule only excludes Unresponsive, so this lead reaches the
    // queue. Exactly one row in the real data does this.
    expect(
      deriveQueueVisibility(
        lead({ funnel_stage: "Not Qualified", lead_status: "Active" }),
        "Ignore Lead",
        TODAY,
      ),
    ).toBe("Include");
  });
});

describe("deriveLead", () => {
  it("derives every field for a lead waiting on a reply", () => {
    expect(
      deriveLead(
        lead({ funnel_stage: "Quote Sent", last_outcome: "Customer Replied" }),
        TODAY,
      ),
    ).toEqual({
      actionRequired: "Reply Required",
      nextAction: "Reply to latest customer message",
      effectiveActionDate: TODAY,
      dueStatus: "Due Today",
      contactPriority: "Contact Today",
      queueVisibility: "Include",
      priorityRank: 1,
    });
  });

  it("ranks the four live bands and leaves Closed unranked", () => {
    expect(deriveLead(lead({ funnel_stage: "Won" }), TODAY).priorityRank).toBeNull();
    expect(
      deriveLead(lead({ funnel_stage: "Nurture" }), TODAY).priorityRank,
    ).toBe(4);
  });
});

describe("compareQueueRows", () => {
  it("ranks by action within a band, matching the sheet's Z→A sort", () => {
    // Same band, same date — the sheet works 07 before 01.
    const rows = [
      { name: "Low", derived: { priorityRank: 2, actionRequired: "Follow Up – No Response", effectiveActionDate: "2026-08-24" } },
      { name: "High", derived: { priorityRank: 2, actionRequired: "Attend / Confirm Appointment", effectiveActionDate: "2026-08-24" } },
      { name: "Leaked", derived: { priorityRank: 2, actionRequired: "Ignore Lead", effectiveActionDate: "2026-08-24" } },
    ] as never[];
    expect([...rows].sort(compareQueueRows).map((r) => (r as { name: string }).name)).toEqual([
      "High",
      "Low",
      "Leaked", // unranked, so it sinks — where the sheet's unnumbered row sits
    ]);
  });

  it("sorts by priority band, then date, then name", () => {
    const act = "Qualify Lead";
    const rows = [
      { name: "Zoe", derived: { priorityRank: 2, actionRequired: act, effectiveActionDate: "2026-08-25" } },
      { name: "Amy", derived: { priorityRank: 1, actionRequired: act, effectiveActionDate: "2026-08-22" } },
      { name: "Bob", derived: { priorityRank: 2, actionRequired: act, effectiveActionDate: "2026-08-24" } },
      { name: "Ann", derived: { priorityRank: 2, actionRequired: act, effectiveActionDate: "2026-08-24" } },
    ] as never[];
    expect([...rows].sort(compareQueueRows).map((r) => (r as { name: string }).name)).toEqual([
      "Amy",
      "Ann",
      "Bob",
      "Zoe",
    ]);
  });

  it("puts rows with no date after rows that have one, within the same band", () => {
    const act = "Qualify Lead";
    const rows = [
      { name: "NoDate", derived: { priorityRank: 2, actionRequired: act, effectiveActionDate: null } },
      { name: "Dated", derived: { priorityRank: 2, actionRequired: act, effectiveActionDate: "2026-09-30" } },
    ] as never[];
    expect([...rows].sort(compareQueueRows).map((r) => (r as { name: string }).name)).toEqual([
      "Dated",
      "NoDate",
    ]);
  });
});
