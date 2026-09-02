import type { FunnelStage } from "./funnel-types";

export const APPOINTMENT_TRACKING_STARTED_AT = new Date("2026-09-01T00:00:00+08:00");

export type AnalyticsLead = {
  id: string;
  name: string;
  lead_ref: string;
  funnel_stage: FunnelStage;
  lead_status: string;
  primary_product: "Curtains / Blinds" | "Mesh" | "Both" | null;
};

export type AnalyticsAppointmentEvent = {
  id: string;
  lead_id: string;
  event_type: "booked" | "rescheduled" | "completed" | "cancelled" | "no_show";
  occurred_at: Date | string;
  is_backfilled: boolean;
};

export type AnalyticsWinEvent = { lead_id: string; changed_at: Date | string };

export type AnalyticsDrilldownItem = {
  key: string;
  leadId: string;
  name: string;
  leadRef: string;
  occurredAt?: string;
};

const rate = (numerator: number, denominator: number) => denominator ? Math.round(numerator / denominator * 1000) / 10 : null;
const instant = (value: Date | string) => new Date(value).getTime();

export function calculateLeadAnalytics(
  leads: AnalyticsLead[],
  appointmentEvents: AnalyticsAppointmentEvent[],
  winEvents: AnalyticsWinEvent[],
  elapsedDays: number,
) {
  const leadById = new Map(leads.map(lead => [lead.id, lead]));
  const trackingStart = APPOINTMENT_TRACKING_STARTED_AT.getTime();
  const events = appointmentEvents.filter(event => leadById.has(event.lead_id) && instant(event.occurred_at) >= trackingStart);
  // Every terminal/reschedule event proves that an appointment existed. This
  // matters for the one-time backfill: an older booking may predate the
  // tracking boundary while its completion was captured after it.
  const booked = new Set(events.map(event => event.lead_id));
  const completedAt = new Map<string, number>();
  for (const event of events.filter(event => event.event_type === "completed")) {
    const at = instant(event.occurred_at);
    completedAt.set(event.lead_id, Math.min(completedAt.get(event.lead_id) ?? at, at));
  }
  const attended = new Set(completedAt.keys());
  const won = new Set(leads.filter(lead => lead.funnel_stage === "Won" || lead.lead_status === "Closed – Won").map(lead => lead.id));
  const curtainsBlinds = new Set(leads.filter(lead => lead.primary_product === "Curtains / Blinds").map(lead => lead.id));
  const mesh = new Set(leads.filter(lead => lead.primary_product === "Mesh").map(lead => lead.id));
  const categorizedProducts = curtainsBlinds.size + mesh.size;
  const orderedWins = new Set(winEvents.filter(event => {
    const completed = completedAt.get(event.lead_id);
    return completed !== undefined && instant(event.changed_at) >= completed;
  }).map(event => event.lead_id));
  const detailForLead = (leadId: string, key = leadId, occurredAt?: Date | string): AnalyticsDrilldownItem | null => {
    const lead = leadById.get(leadId);
    return lead ? { key, leadId, name: lead.name, leadRef: lead.lead_ref, ...(occurredAt ? { occurredAt: new Date(occurredAt).toISOString() } : {}) } : null;
  };
  const uniqueDetails = (ids: Iterable<string>) => [...ids].map(id => detailForLead(id)).filter((item): item is AnalyticsDrilldownItem => item !== null);
  const eventDetails = (type: AnalyticsAppointmentEvent["event_type"]) => events.filter(event => event.event_type === type)
    .map(event => detailForLead(event.lead_id, event.id, event.occurred_at))
    .filter((item): item is AnalyticsDrilldownItem => item !== null);

  return {
    leads: leads.length,
    averageLeadsPerDay: elapsedDays ? Math.round(leads.length / elapsedDays * 10) / 10 : 0,
    booked: booked.size,
    attended: attended.size,
    appointmentWins: orderedWins.size,
    won: won.size,
    cancelled: events.filter(item => item.event_type === "cancelled").length,
    noShow: events.filter(item => item.event_type === "no_show").length,
    leadToAppointmentRate: rate(booked.size, leads.length),
    appointmentAttendanceRate: rate(attended.size, booked.size),
    appointmentClosingRate: rate(orderedWins.size, attended.size),
    leadToSalesRate: rate(won.size, leads.length),
    productMix: {
      curtainsBlinds: curtainsBlinds.size,
      mesh: mesh.size,
      curtainsBlindsRate: rate(curtainsBlinds.size, categorizedProducts),
      meshRate: rate(mesh.size, categorizedProducts),
      categorized: categorizedProducts,
      unclassified: leads.length - categorizedProducts,
    },
    backfilledEventCount: events.filter(event => event.is_backfilled).length,
    details: {
      leads: uniqueDetails(leads.map(lead => lead.id)),
      booked: uniqueDetails(booked),
      attended: uniqueDetails(attended),
      appointmentWins: uniqueDetails(orderedWins),
      won: uniqueDetails(won),
      curtainsBlinds: uniqueDetails(curtainsBlinds),
      mesh: uniqueDetails(mesh),
      cancelled: eventDetails("cancelled"),
      noShow: eventDetails("no_show"),
    },
  };
}

export function analyticsMonthWindow(requestedMonth: string | undefined, today: string) {
  const currentMonth = today.slice(0, 7);
  const month = requestedMonth && /^\d{4}-(0[1-9]|1[0-2])$/.test(requestedMonth) ? requestedMonth : currentMonth;
  const [year, monthNumber] = month.split("-").map(Number);
  const nextYear = monthNumber === 12 ? year + 1 : year;
  const nextMonthNumber = monthNumber === 12 ? 1 : monthNumber + 1;
  const nextMonth = `${nextYear}-${String(nextMonthNumber).padStart(2, "0")}`;
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const elapsedDays = month < currentMonth ? daysInMonth : month > currentMonth ? 0 : Number(today.slice(8, 10));
  return {
    month, elapsedDays, daysInMonth,
    start: new Date(`${month}-01T00:00:00+08:00`),
    end: new Date(`${nextMonth}-01T00:00:00+08:00`),
  };
}

export function inclusiveCalendarDays(start: string | null, end: string) {
  if (!start) return 0;
  return Math.max(0, Math.floor((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1);
}
