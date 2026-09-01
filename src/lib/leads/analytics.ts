import type { FunnelStage } from "./funnel-types";

export type AnalyticsLead = { id: string; funnel_stage: FunnelStage; lead_status: string };
export type AnalyticsAppointment = { lead_id: string; status: "scheduled" | "completed" | "cancelled" | "no_show" };

const rate = (numerator: number, denominator: number) => denominator ? Math.round(numerator / denominator * 1000) / 10 : null;
const uniqueLeads = (appointments: AnalyticsAppointment[], status?: AnalyticsAppointment["status"]) => new Set(appointments.filter(item => !status || item.status === status).map(item => item.lead_id));

export function calculateLeadAnalytics(leads: AnalyticsLead[], appointments: AnalyticsAppointment[], elapsedDays: number) {
  const booked = uniqueLeads(appointments);
  const attended = uniqueLeads(appointments, "completed");
  const won = new Set(leads.filter(lead => lead.funnel_stage === "Won" || lead.lead_status === "Closed – Won").map(lead => lead.id));
  const appointmentWins = [...attended].filter(id => won.has(id)).length;
  return {
    leads: leads.length,
    averageLeadsPerDay: elapsedDays ? Math.round(leads.length / elapsedDays * 10) / 10 : 0,
    booked: booked.size,
    attended: attended.size,
    appointmentWins,
    won: won.size,
    cancelled: appointments.filter(item => item.status === "cancelled").length,
    noShow: appointments.filter(item => item.status === "no_show").length,
    leadToAppointmentRate: rate(booked.size, leads.length),
    appointmentAttendanceRate: rate(attended.size, booked.size),
    appointmentClosingRate: rate(appointmentWins, attended.size),
    leadToSalesRate: rate(won.size, leads.length),
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
