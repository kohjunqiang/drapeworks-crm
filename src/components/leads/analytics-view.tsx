"use client";

import type { calculateLeadAnalytics } from "@/lib/leads/analytics";

type Metrics = ReturnType<typeof calculateLeadAnalytics>;

const percent = (value: number | null) => value == null ? "Not available" : `${value}%`;

export function LeadAnalyticsView({ metrics, period, availableMonths, elapsedDays, daysInPeriod, asOf }: {
  metrics: Metrics;
  period: string;
  availableMonths: string[];
  elapsedDays: number;
  daysInPeriod: number;
  asOf: string;
}) {
  const formatMonth = (month: string) => new Intl.DateTimeFormat("en-SG", {
    month: "long",
    year: "numeric",
    timeZone: "Asia/Singapore",
  }).format(new Date(`${month}-01T00:00:00+08:00`));
  const allTime = period === "all";
  const periodLabel = allTime ? "All-time" : formatMonth(period);
  const asOfLabel = new Intl.DateTimeFormat("en-SG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Singapore",
  }).format(new Date(`${asOf}T00:00:00+08:00`));
  const summary = [
    { label: "Calendar days elapsed", value: elapsedDays, detail: allTime ? "From the first initiated lead through today" : `${daysInPeriod} days in ${periodLabel}` },
    { label: "Leads initiated", value: metrics.leads, detail: allTime ? "Across all available months" : `Started in ${periodLabel}` },
    { label: "Average Leads per Day", value: metrics.averageLeadsPerDay, detail: "Based on elapsed calendar days" },
    { label: "Closed-Won Leads", value: metrics.won, detail: `${percent(metrics.leadToSalesRate)} lead-to-sale rate` },
  ];
  const stages = [
    { label: "Cohort Leads", value: metrics.leads, detail: allTime ? "Initiated across all dates" : `Initiated in ${periodLabel}` },
    { label: "Leads with Appointment", value: metrics.booked, detail: `${percent(metrics.leadToAppointmentRate)} of cohort leads` },
    { label: "Leads that Attended", value: metrics.attended, detail: metrics.booked ? `${percent(metrics.appointmentAttendanceRate)} of leads with an appointment` : "Not available — no appointment records" },
    { label: "Closed Won after Attendance", value: metrics.appointmentWins, detail: metrics.attended ? `${percent(metrics.appointmentClosingRate)} of attended leads` : "Not available — no completed appointments" },
  ];

  return <>
    <section className="mb-5 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{periodLabel} lead cohort</h2>
          <p className="mt-1 text-sm text-slate-500">Outcomes as of {asOfLabel} · Asia/Singapore</p>
        </div>
        <form action="/leads">
          <input type="hidden" name="view" value="analytics"/>
          <label className="block text-xs font-medium text-slate-600">Period
            <select aria-label="Analytics period" name="month" defaultValue={period} onChange={event => event.currentTarget.form?.requestSubmit()} className="mt-1 block h-10 min-w-48 rounded-lg border border-slate-200 bg-white px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500">
              <option value="all">All months</option>
              {availableMonths.map(month => <option key={month} value={month}>{formatMonth(month)}</option>)}
            </select>
          </label>
        </form>
      </div>
    </section>

    <dl className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
      {summary.map(item => <div key={item.label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{item.label}</dt>
        <dd className="mt-2 text-2xl font-semibold text-slate-900">{item.value}</dd>
        <dd className="mt-1 text-sm text-slate-500">{item.detail}</dd>
      </div>)}
    </dl>

    <section className="mb-5 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-4">
        <h2 className="font-semibold text-slate-900">Appointment conversion</h2>
        <p className="mt-1 text-sm text-slate-500">Unique leads from the {periodLabel.toLowerCase()} cohort, followed through current CRM appointment records.</p>
      </div>
      <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
        Historical appointments stored only in imported notes are not counted. A zero here may mean appointment history is incomplete, not that no appointment occurred.
      </div>
      <dl className="grid gap-3 md:grid-cols-4">
        {stages.map((stage, index) => <div key={stage.label} className="relative rounded-xl border border-slate-200 bg-slate-50/60 p-4">
          {index > 0 && <span aria-hidden="true" className="absolute -left-3 top-1/2 hidden -translate-y-1/2 text-slate-400 md:block">→</span>}
          <dt className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500"><span className="inline-flex size-6 items-center justify-center rounded-full bg-slate-200 text-slate-700">{index + 1}</span>{stage.label}</dt>
          <dd className="mt-2 text-3xl font-semibold text-slate-900">{stage.value}</dd>
          <dd className="mt-1 text-sm text-slate-500">{stage.detail}</dd>
        </div>)}
      </dl>
      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3"><dt className="inline text-sm font-medium text-amber-950">Cancelled appointment records</dt><dd className="float-right font-semibold text-amber-950">{metrics.cancelled}</dd></div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3"><dt className="inline text-sm font-medium text-slate-700">No-show appointment records</dt><dd className="float-right font-semibold text-slate-900">{metrics.noShow}</dd></div>
      </dl>
    </section>
    <p className="text-xs text-slate-500">Cohort membership is based on initiation month. Outcomes use the lead’s current state as of {asOfLabel}.</p>
  </>;
}
