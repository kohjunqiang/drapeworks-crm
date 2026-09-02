import { describe, expect, it } from "vitest";
import { analyticsMonthWindow, calculateLeadAnalytics, inclusiveCalendarDays } from "./analytics";

describe("lead analytics", () => {
  it("calculates a coherent cohort funnel and deduplicates repeat appointments", () => {
    const leads = [
      { id: "a", name: "A", lead_ref: "L-A", funnel_stage: "Won" as const, lead_status: "Closed – Won", primary_product: "Curtains / Blinds" as const },
      { id: "b", name: "B", lead_ref: "L-B", funnel_stage: "Attend Appointment" as const, lead_status: "Active", primary_product: "Mesh" as const },
      { id: "c", name: "C", lead_ref: "L-C", funnel_stage: "Qualify Lead" as const, lead_status: "Active", primary_product: null },
      { id: "d", name: "D", lead_ref: "L-D", funnel_stage: "Qualify Lead" as const, lead_status: "Active", primary_product: "Both" as const },
    ];
    const events = [
      { id: "a-booked", lead_id: "a", event_type: "booked" as const, occurred_at: "2026-09-01T01:00:00Z", is_backfilled: false },
      { id: "a-completed", lead_id: "a", event_type: "completed" as const, occurred_at: "2026-09-02T01:00:00Z", is_backfilled: false },
      { id: "a-cancelled", lead_id: "a", event_type: "cancelled" as const, occurred_at: "2026-09-03T01:00:00Z", is_backfilled: false },
      { id: "b-booked", lead_id: "b", event_type: "booked" as const, occurred_at: "2026-09-01T02:00:00Z", is_backfilled: false },
      { id: "b-no-show", lead_id: "b", event_type: "no_show" as const, occurred_at: "2026-09-02T02:00:00Z", is_backfilled: false },
    ];
    const result = calculateLeadAnalytics(leads, events, [{ lead_id: "a", changed_at: "2026-09-04T01:00:00Z" }], 2);
    expect(result).toMatchObject({ leads: 4, averageLeadsPerDay: 2, booked: 2, attended: 1, appointmentWins: 1, won: 1, cancelled: 1, noShow: 1, leadToAppointmentRate: 50, appointmentAttendanceRate: 50, appointmentClosingRate: 100, leadToSalesRate: 25, backfilledEventCount: 0 });
    expect(result.details.appointmentWins).toEqual([{ key: "a", leadId: "a", name: "A", leadRef: "L-A" }]);
    expect(result.details.cancelled[0]).toMatchObject({ key: "a-cancelled", leadId: "a" });
    expect(result.productMix).toEqual({ curtainsBlinds: 1, mesh: 1, curtainsBlindsRate: 50, meshRate: 50, categorized: 2, unclassified: 2 });
  });
  it("uses null rather than a misleading zero percent without a denominator", () => {
    const result = calculateLeadAnalytics([], [], [], 0);
    expect(result.leadToAppointmentRate).toBeNull();
    expect(result.appointmentClosingRate).toBeNull();
  });
  it("does not count a win that happened before appointment attendance", () => {
    const leads = [{ id: "a", name: "A", lead_ref: "L-A", funnel_stage: "Won" as const, lead_status: "Closed – Won", primary_product: null }];
    const events = [
      { id: "booked", lead_id: "a", event_type: "booked" as const, occurred_at: "2026-09-02T00:00:00Z", is_backfilled: false },
      { id: "completed", lead_id: "a", event_type: "completed" as const, occurred_at: "2026-09-03T00:00:00Z", is_backfilled: false },
    ];
    expect(calculateLeadAnalytics(leads, events, [{ lead_id: "a", changed_at: "2026-09-01T00:00:00Z" }], 3).appointmentWins).toBe(0);
  });
  it("ignores appointment events before the tracking boundary", () => {
    const leads = [{ id: "a", name: "A", lead_ref: "L-A", funnel_stage: "Qualify Lead" as const, lead_status: "Active", primary_product: null }];
    const events = [{ id: "old", lead_id: "a", event_type: "booked" as const, occurred_at: "2026-08-31T15:59:59Z", is_backfilled: true }];
    expect(calculateLeadAnalytics(leads, events, [], 1).booked).toBe(0);
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
