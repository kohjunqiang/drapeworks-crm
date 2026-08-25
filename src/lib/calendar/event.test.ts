import { describe, expect, it } from "vitest";

import { buildConsultationEvent } from "./event";

const base = {
  customerName: "Mindy",
  customerMobile: "+6596253507",
  development: "Tembusu Grand",
  address: "12 Tanjong Katong Rd #08-11",
  notes: "Day + night, 4 windows",
  leadRef: "WA-6596253507",
  leadId: "3f1c7e2a-0000-4000-8000-000000000001",
  scheduledAt: new Date("2026-08-25T02:30:00Z"), // 10:30 SGT
  durationMins: 90,
  appUrl: "https://crm.drapeworks.sg",
};

describe("buildConsultationEvent", () => {
  it("titles the event with customer and development", () => {
    expect(buildConsultationEvent(base).summary).toBe(
      "Consultation — Mindy (Tembusu Grand)",
    );
  });

  it("omits the parenthetical when there is no development", () => {
    expect(
      buildConsultationEvent({ ...base, development: null }).summary,
    ).toBe("Consultation — Mindy");
  });

  it("puts the mobile, lead ref, notes and a deep link in the description", () => {
    const description = buildConsultationEvent(base).description;
    expect(description).toContain("Mobile: +6596253507");
    expect(description).toContain("Lead: WA-6596253507");
    expect(description).toContain("Day + night, 4 windows");
    expect(description).toContain(
      "https://crm.drapeworks.sg/leads/3f1c7e2a-0000-4000-8000-000000000001",
    );
  });

  it("ends the event duration_mins after it starts, in Singapore time", () => {
    const event = buildConsultationEvent(base);
    expect(event.start).toEqual({
      dateTime: "2026-08-25T02:30:00.000Z",
      timeZone: "Asia/Singapore",
    });
    expect(event.end).toEqual({
      dateTime: "2026-08-25T04:00:00.000Z",
      timeZone: "Asia/Singapore",
    });
  });

  it("never adds attendees — the customer must not be emailed by the CRM", () => {
    expect(buildConsultationEvent(base)).not.toHaveProperty("attendees");
  });

  it("survives a lead with no mobile, address or notes", () => {
    const event = buildConsultationEvent({
      ...base,
      customerMobile: null,
      address: null,
      notes: null,
    });
    expect(event.location).toBeUndefined();
    expect(event.description).not.toContain("Mobile:");
    expect(event.description).toContain("Lead: WA-6596253507");
  });
});
