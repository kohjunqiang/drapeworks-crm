import { describe, expect, it } from "vitest";

import { deriveActionRequired } from "./queue-engine";
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

import { deriveNextAction } from "./queue-engine";

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

import { deriveDueStatus, deriveEffectiveActionDate } from "./queue-engine";

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

import { deriveContactPriority } from "./queue-engine";

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
