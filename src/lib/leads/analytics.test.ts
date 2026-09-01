import { describe, expect, it } from "vitest";
import { analyticsMonthWindow, calculateLeadAnalytics, inclusiveCalendarDays } from "./analytics";

describe("lead analytics", () => {
  it("calculates a coherent cohort funnel and deduplicates repeat appointments", () => {
    const leads = [
      { id: "a", funnel_stage: "Won" as const, lead_status: "Closed – Won", latest_quote_cents: 10000 },
      { id: "b", funnel_stage: "Attend Appointment" as const, lead_status: "Active", latest_quote_cents: 25000 },
      { id: "c", funnel_stage: "Qualify Lead" as const, lead_status: "Active", latest_quote_cents: null },
      { id: "d", funnel_stage: "Qualify Lead" as const, lead_status: "Active", latest_quote_cents: 5000 },
    ];
    const appointments = [
      { lead_id: "a", status: "completed" as const }, { lead_id: "a", status: "cancelled" as const },
      { lead_id: "b", status: "scheduled" as const }, { lead_id: "b", status: "no_show" as const },
    ];
    expect(calculateLeadAnalytics(leads, appointments, 2)).toEqual({
      leads: 4, averageLeadsPerDay: 2, booked: 2, attended: 1, appointmentWins: 1, won: 1,
      cancelled: 1, noShow: 1, leadToAppointmentRate: 50,
      appointmentAttendanceRate: 50, appointmentClosingRate: 100,
      leadToSalesRate: 25,
    });
  });
  it("uses null rather than a misleading zero percent without a denominator", () => {
    const result = calculateLeadAnalytics([], [], 0);
    expect(result.leadToAppointmentRate).toBeNull();
    expect(result.appointmentClosingRate).toBeNull();
  });
  it("uses elapsed days for the current month and full days for a past month", () => {
    expect(analyticsMonthWindow(undefined, "2026-09-12")).toMatchObject({ month: "2026-09", elapsedDays: 12, daysInMonth: 30 });
    expect(analyticsMonthWindow("2026-02", "2026-09-12")).toMatchObject({ elapsedDays: 28, daysInMonth: 28 });
  });
  it("counts all-time calendar days inclusively", () => {
    expect(inclusiveCalendarDays("2026-08-30", "2026-09-01")).toBe(3);
    expect(inclusiveCalendarDays(null, "2026-09-01")).toBe(0);
  });
});
