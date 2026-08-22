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
