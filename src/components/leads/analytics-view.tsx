"use client";

import { useState } from "react";
import Link from "next/link";
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
  const [drilldown, setDrilldown] = useState<keyof Metrics["details"] | null>(null);
  const formatMonth = (month: string) => new Intl.DateTimeFormat("en-SG", {
    month: "long",
    year: "numeric",
    timeZone: "Asia/Singapore",
  }).format(new Date(`${month}-01T00:00:00+08:00`));
  const allTime = period === "all";
  const currentMonth = period === asOf.slice(0, 7);
  // During a rolling deployment or a Turbopack hot refresh, the client can
  // briefly receive metrics produced by the previous server module. Keep the
  // analytics page usable until the matching server payload arrives.
  const productMix = metrics.productMix ?? {
    curtainsBlinds: 0, mesh: 0, curtainsBlindsRate: null, meshRate: null,
    categorized: 0, unclassified: metrics.leads,
  };
  const periodLabel = allTime ? "All-time" : formatMonth(period);
  const asOfLabel = new Intl.DateTimeFormat("en-SG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Singapore",
  }).format(new Date(`${asOf}T00:00:00+08:00`));
  const summary = [
    { label: "Calendar days elapsed", value: elapsedDays, detail: allTime ? "From the first initiated lead through today" : `${daysInPeriod} days in ${periodLabel}`, drilldown: null },
    { label: "Leads initiated", value: metrics.leads, detail: allTime ? "Across all available months" : `Started in ${periodLabel}`, drilldown: "leads" as const },
    { label: "Average Leads per Day", value: metrics.averageLeadsPerDay, detail: "Based on elapsed calendar days", drilldown: null },
    { label: "Closed-Won Leads", value: metrics.won, detail: `${percent(metrics.leadToSalesRate)} lead-to-sale rate`, drilldown: "won" as const },
  ];
  const stages = [
    { label: "Cohort Leads", value: metrics.leads, detail: allTime ? "Initiated across all dates" : `Initiated in ${periodLabel}`, drilldown: "leads" as const },
    { label: "Leads with Appointment", value: metrics.booked, detail: `${percent(metrics.leadToAppointmentRate)} of cohort leads`, drilldown: "booked" as const },
    { label: "Leads that Attended", value: metrics.attended, detail: metrics.booked ? `${percent(metrics.appointmentAttendanceRate)} of leads with an appointment` : "Not available — no appointment records", drilldown: "attended" as const },
    { label: "Closed Won after Attendance", value: metrics.appointmentWins, detail: metrics.attended ? `${percent(metrics.appointmentClosingRate)} of attended leads` : "Not available — no completed appointments", drilldown: "appointmentWins" as const },
  ];
  const appointmentHistoryIncomplete = metrics.booked === 0 && metrics.won > 0;
  const conversionRates = [
    {
      label: "Lead → Appointment",
      value: appointmentHistoryIncomplete ? "Not available" : percent(metrics.leadToAppointmentRate),
      detail: appointmentHistoryIncomplete ? "Historical appointment records are incomplete" : "Leads with an appointment ÷ cohort leads",
      drilldown: "booked" as const,
    },
    {
      label: "Appointment → Closed Won",
      value: percent(metrics.appointmentClosingRate),
      detail: metrics.attended ? "Closed-Won leads after attendance ÷ attended leads" : "No completed appointment records",
      drilldown: "appointmentWins" as const,
    },
  ];
  const drilldownTitles: Record<keyof Metrics["details"], string> = {
    leads: "Cohort leads", booked: "Leads with an appointment", attended: "Leads that attended",
    appointmentWins: "Closed Won after attendance", won: "Closed-Won leads",
    curtainsBlinds: "Curtains / Blinds leads", mesh: "Mesh leads",
    cancelled: "Cancelled appointment events", noShow: "No-show appointment events",
  };
  const drilldownItems = drilldown ? metrics.details[drilldown] : [];

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
        <dd className="mt-2 text-2xl font-semibold text-slate-900">{item.drilldown ? <button type="button" onClick={() => setDrilldown(item.drilldown)} className="rounded text-left underline decoration-slate-300 underline-offset-4 hover:text-teal-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500">{item.value}</button> : item.value}</dd>
        <dd className="mt-1 text-sm text-slate-500">{item.detail}</dd>
      </div>)}
    </dl>

    {currentMonth && <section className="mb-5 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-4"><h2 className="font-semibold text-slate-900">Current month product mix</h2><p className="mt-1 text-sm text-slate-500">Share of this month’s leads assigned to Curtains / Blinds or Mesh.</p></div>
      {productMix.categorized ? <>
        <div className="mb-4 flex h-3 overflow-hidden rounded-full bg-slate-100" aria-label={`${percent(productMix.curtainsBlindsRate)} Curtains / Blinds and ${percent(productMix.meshRate)} Mesh`}>
          <div className="bg-teal-600" style={{ width: `${productMix.curtainsBlindsRate ?? 0}%` }}/>
          <div className="bg-sky-500" style={{ width: `${productMix.meshRate ?? 0}%` }}/>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <button type="button" onClick={() => setDrilldown("curtainsBlinds")} className="rounded-xl border border-teal-200 bg-teal-50/60 p-4 text-left hover:bg-teal-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"><span className="flex items-center gap-2 text-sm font-medium text-teal-900"><span className="size-2.5 rounded-full bg-teal-600"/>Curtains / Blinds</span><span className="mt-2 block text-3xl font-semibold text-slate-900">{percent(productMix.curtainsBlindsRate)}</span><span className="mt-1 block text-sm text-slate-600">{productMix.curtainsBlinds} of {productMix.categorized} categorized leads</span></button>
          <button type="button" onClick={() => setDrilldown("mesh")} className="rounded-xl border border-sky-200 bg-sky-50/60 p-4 text-left hover:bg-sky-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"><span className="flex items-center gap-2 text-sm font-medium text-sky-900"><span className="size-2.5 rounded-full bg-sky-500"/>Mesh</span><span className="mt-2 block text-3xl font-semibold text-slate-900">{percent(productMix.meshRate)}</span><span className="mt-1 block text-sm text-slate-600">{productMix.mesh} of {productMix.categorized} categorized leads</span></button>
        </div>
      </> : <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">No current-month leads have a product selected yet.</p>}
      {productMix.unclassified > 0 && <p className="mt-3 text-xs text-slate-500">{productMix.unclassified} lead{productMix.unclassified === 1 ? " is" : "s are"} not included because the product is blank or uses the legacy “Both” value.</p>}
    </section>}

    <section className="mb-5">
      <h2 className="mb-3 font-semibold text-slate-900">Conversion rates</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {conversionRates.map(item => <button type="button" onClick={() => setDrilldown(item.drilldown)} key={item.label} className="rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition-colors hover:border-teal-300 hover:bg-teal-50/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 sm:p-5">
          <span className="block text-sm font-medium text-slate-600">{item.label}</span>
          <span className="mt-2 block text-3xl font-semibold text-slate-900">{item.value}</span>
          <span className="mt-1 block text-sm text-slate-500">{item.detail}</span>
        </button>)}
      </div>
    </section>

    <section className="mb-5 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-4">
        <h2 className="font-semibold text-slate-900">Appointment conversion</h2>
        <p className="mt-1 text-sm text-slate-500">Unique leads from the {periodLabel.toLowerCase()} cohort, followed through current CRM appointment records.</p>
      </div>
      <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
        Structured appointment tracking begins 1 Sep 2026. Earlier appointments stored only in imported notes are not counted.{metrics.backfilledEventCount ? ` ${metrics.backfilledEventCount} event${metrics.backfilledEventCount === 1 ? " was" : "s were"} inferred from existing appointment records.` : ""}
      </div>
      <dl className="grid gap-3 md:grid-cols-4">
        {stages.map((stage, index) => <div key={stage.label} className="relative rounded-xl border border-slate-200 bg-slate-50/60 p-4">
          {index > 0 && <span aria-hidden="true" className="absolute -left-3 top-1/2 hidden -translate-y-1/2 text-slate-400 md:block">→</span>}
          <dt className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500"><span className="inline-flex size-6 items-center justify-center rounded-full bg-slate-200 text-slate-700">{index + 1}</span>{stage.label}</dt>
          <dd className="mt-2 text-3xl font-semibold text-slate-900"><button type="button" onClick={() => setDrilldown(stage.drilldown)} className="rounded text-left underline decoration-slate-300 underline-offset-4 hover:text-teal-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500">{stage.value}</button></dd>
          <dd className="mt-1 text-sm text-slate-500">{stage.detail}</dd>
        </div>)}
      </dl>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <button type="button" onClick={() => setDrilldown("cancelled")} className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-left hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"><span className="text-sm font-medium text-amber-950">Cancelled appointment events</span><span className="float-right font-semibold text-amber-950 underline decoration-amber-300 underline-offset-4">{metrics.cancelled}</span></button>
        <button type="button" onClick={() => setDrilldown("noShow")} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-left hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"><span className="text-sm font-medium text-slate-700">No-show appointment events</span><span className="float-right font-semibold text-slate-900 underline decoration-slate-300 underline-offset-4">{metrics.noShow}</span></button>
      </div>
    </section>
    <p className="text-xs text-slate-500">Cohort membership is based on initiation month. Outcomes use the lead’s current state as of {asOfLabel}.</p>
    {drilldown && <div role="dialog" aria-modal="true" aria-labelledby="analytics-drilldown-title" className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-6" onMouseDown={event => { if (event.target === event.currentTarget) setDrilldown(null); }}>
      <section className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl">
        <header className="flex items-center justify-between gap-4 border-b border-slate-200 p-4 sm:p-5"><div><h2 id="analytics-drilldown-title" className="text-lg font-semibold text-slate-900">{drilldownTitles[drilldown]}</h2><p className="text-sm text-slate-500">{drilldownItems.length} {drilldown === "cancelled" || drilldown === "noShow" ? "event" : "lead"}{drilldownItems.length === 1 ? "" : "s"}</p></div><button type="button" onClick={() => setDrilldown(null)} className="inline-flex size-10 items-center justify-center rounded-lg border border-slate-200 text-xl text-slate-600 hover:bg-slate-50" aria-label="Close drilldown">×</button></header>
        <div className="overflow-y-auto p-4 sm:p-5">{drilldownItems.length ? <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">{drilldownItems.map(item => <li key={item.key} className="flex items-center justify-between gap-4 p-3"><div className="min-w-0"><div className="truncate font-medium text-slate-900">{item.name}</div><div className="text-xs text-slate-500">{item.leadRef}{item.occurredAt ? ` · ${new Intl.DateTimeFormat("en-SG", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Singapore" }).format(new Date(item.occurredAt))}` : ""}</div></div><Link href={`/leads?view=all&q=${encodeURIComponent(item.leadRef)}`} className="shrink-0 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Open lead</Link></li>)}</ul> : <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">No matching records.</p>}</div>
      </section>
    </div>}
  </>;
}
