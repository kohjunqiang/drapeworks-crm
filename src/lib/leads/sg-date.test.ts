import { describe, expect, it } from "vitest";

import { addDays, toSgDate, todayInSingapore } from "./sg-date";

describe("toSgDate", () => {
  it("uses the Singapore calendar day, not the UTC one", () => {
    // 2026-08-21T23:00:00Z is already 07:00 on the 22nd in Singapore (UTC+8).
    // A naive toISOString().slice(0,10) would answer '2026-08-21' and put a
    // lead due today into the Overdue band for the first eight hours of the day.
    expect(toSgDate(new Date("2026-08-21T23:00:00Z"))).toBe("2026-08-22");
  });

  it("keeps the same day when UTC and Singapore agree", () => {
    expect(toSgDate(new Date("2026-08-22T04:00:00Z"))).toBe("2026-08-22");
  });

  it("handles the last instant before the Singapore rollover", () => {
    // 15:59Z is 23:59 SGT on the same date.
    expect(toSgDate(new Date("2026-08-22T15:59:00Z"))).toBe("2026-08-22");
    expect(toSgDate(new Date("2026-08-22T16:00:00Z"))).toBe("2026-08-23");
  });
});

describe("addDays", () => {
  it("adds days", () => {
    expect(addDays("2026-08-22", 3)).toBe("2026-08-25");
  });

  it("rolls over a month boundary", () => {
    expect(addDays("2026-08-30", 3)).toBe("2026-09-02");
  });

  it("rolls back across a year boundary", () => {
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("handles the 90-day stale window", () => {
    expect(addDays("2026-08-22", -90)).toBe("2026-05-24");
  });
});

describe("todayInSingapore", () => {
  it("returns an ISO date string", () => {
    expect(todayInSingapore()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("ordering", () => {
  it("sorts correctly as plain strings — this is why SgDate is a string", () => {
    const dates = ["2026-09-01", "2026-08-30", "2026-08-22"];
    expect([...dates].sort()).toEqual([
      "2026-08-22",
      "2026-08-30",
      "2026-09-01",
    ]);
  });
});
