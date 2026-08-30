import Link from "next/link";
import { sql } from "kysely";

import { db } from "@/lib/db/kysely";
import { deriveLead, STAGE_RANK } from "@/lib/leads/funnel-engine";
import { todayInSingapore, toSgDate, type SgDate } from "@/lib/leads/sg-date";
import { formatSGD } from "@/lib/money";
import { QuickEditLead } from "@/components/leads/phase16-forms";
import { EditableLeadRow } from "@/components/leads/editable-lead-row";

const GROUPS = ["Closed", "Overdue", "Due Today", "Upcoming", "No Date"] as const;
const GROUP_LABELS = { Closed: "Needs closing", Overdue: "Overdue", "Due Today": "Due today", Upcoming: "Upcoming", "No Date": "Unscheduled" } as const;
const GROUP_STYLES = { Closed: "border-rose-200 bg-rose-50 text-rose-700", Overdue: "border-amber-200 bg-amber-50 text-amber-700", "Due Today": "border-teal-200 bg-teal-50 text-teal-700", Upcoming: "border-sky-200 bg-sky-50 text-sky-700", "No Date": "border-slate-200 bg-slate-50 text-slate-600" } as const;

export async function WorkView({ params, userId }: { params: Record<string, string | undefined>; userId: string }) {
  const owner = params.owner;
  const today = todayInSingapore();
  const profiles = await db.selectFrom("profiles").select(["id", "full_name", "is_presales_owner"]).execute();
  const consultants = profiles.map(({ id, full_name }) => ({ id, full_name }));
  const presales = profiles.find(profile => profile.is_presales_owner)?.id ?? null;
  const names = new Map(profiles.map(profile => [profile.id, profile.full_name ?? "Unnamed"]));
  const leads = await db.selectFrom("leads").selectAll().select([
    sql<string | null>`next_action_date::text`.as("next_action_date_text"),
    sql<string | null>`move_in_date::text`.as("move_in_date_text"),
  ]).where("is_archived", "=", false).where("lead_status", "in", ["Active", "Unresponsive"]).execute();
  const rows = leads.map(lead => {
    const input = { ...lead, next_action_date: lead.next_action_date_text as SgDate | null, move_in_date: lead.move_in_date_text as SgDate | null, quotation_sent_at: lead.quotation_sent_at ? toSgDate(new Date(lead.quotation_sent_at)) : null };
    return { ...lead, next_action_date: lead.next_action_date_text, move_in_date: lead.move_in_date_text, derived: deriveLead(input, today, presales) };
  }).filter(row => row.derived.dueStatus === "Closed" || row.lead_status !== "Unresponsive" || (row.next_action_date_text !== null && row.next_action_date_text <= today))
    .filter(row => owner === "team" || row.derived.currentOwnerId === userId)
    .sort((a, b) => { const rank: Record<string, number> = { Closed: -1, Overdue: 0, "Due Today": 1, Upcoming: 2, "No Date": 3 }; return rank[a.derived.dueStatus] - rank[b.derived.dueStatus] || STAGE_RANK[b.funnel_stage] - STAGE_RANK[a.funnel_stage] || String(a.next_action_date_text ?? "9999").localeCompare(String(b.next_action_date_text ?? "9999")) || (b.latest_quote_cents ?? 0) - (a.latest_quote_cents ?? 0) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id); });
  const pipeline = rows.reduce((sum, row) => sum + (row.latest_quote_cents ?? 0), 0);
  const overdue = rows.filter(row => row.derived.dueStatus === "Overdue").length;
  const dueToday = rows.filter(row => row.derived.dueStatus === "Due Today").length;
  const requestedPageSize = Number.parseInt(params.pageSize ?? "25", 10);
  const pageSize = [10, 25, 50].includes(requestedPageSize) ? requestedPageSize : 25;
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const requestedPage = Number.parseInt(params.page ?? "1", 10);
  const page = Math.min(Math.max(Number.isFinite(requestedPage) ? requestedPage : 1, 1), pageCount);
  const pageRows = rows.slice((page - 1) * pageSize, page * pageSize);
  const pageGroups = GROUPS.filter(group => pageRows.some(row => row.derived.dueStatus === group));
  const pageHref = (nextPage: number) => { const next = new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => entry[1] !== undefined)); next.set("view", "work"); next.set("page", String(nextPage)); return `/leads?${next.toString()}`; };
  const pageSizeHref = (size: number) => { const next = new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => entry[1] !== undefined && entry[0] !== "page")); next.set("view", "work"); next.set("pageSize", String(size)); return `/leads?${next.toString()}`; };

  return <>
    <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
      {[{ label: "Open work", value: rows.length }, { label: "Overdue", value: overdue }, { label: "Due today", value: dueToday }, { label: "Pipeline", value: formatSGD(pipeline) }].map(stat => <div key={stat.label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="text-xs font-medium uppercase tracking-wide text-slate-500">{stat.label}</div><div className="mt-1 text-xl font-semibold text-slate-900">{stat.value}</div></div>)}
    </div>
    <div className="mb-4 flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between"><p className="text-sm text-slate-500">Prioritized by urgency, stage, next date, and quote value.</p><div className="flex flex-wrap items-center justify-end gap-3"><div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1"><Link href={`/leads?view=work&pageSize=${pageSize}`} className={`min-w-16 rounded-md px-3 py-2 text-center text-sm font-medium ${owner !== "team" ? "bg-slate-900 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100"}`}>Mine</Link><Link href={`/leads?view=work&owner=team&pageSize=${pageSize}`} className={`min-w-16 rounded-md px-3 py-2 text-center text-sm font-medium ${owner === "team" ? "bg-slate-900 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100"}`}>Team</Link></div></div></div>
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div className="flex flex-wrap items-center gap-2"><h2 className="flex items-center gap-2 font-semibold"><span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700">Work queue</span><span className="text-sm text-slate-500">{rows.length}</span></h2>{pageGroups.map(group => <span key={group} className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${GROUP_STYLES[group]}`}>{GROUP_LABELS[group]} <span className="ml-1 opacity-75">{rows.filter(row => row.derived.dueStatus === group).length}</span></span>)}</div><nav aria-label="Work queue top pagination" className="flex items-center gap-1"><Link aria-disabled={page === 1} tabIndex={page === 1 ? -1 : undefined} className={`inline-flex h-8 items-center justify-center rounded-lg border px-2.5 text-xs font-medium ${page === 1 ? "pointer-events-none border-slate-200 text-slate-300" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`} href={pageHref(Math.max(1, page - 1))}>Previous</Link><span className="min-w-20 text-center text-xs text-slate-500">Page {page} of {pageCount}</span><Link aria-disabled={page === pageCount} tabIndex={page === pageCount ? -1 : undefined} className={`inline-flex h-8 items-center justify-center rounded-lg border px-2.5 text-xs font-medium ${page === pageCount ? "pointer-events-none border-slate-200 text-slate-300" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`} href={pageHref(Math.min(pageCount, page + 1))}>Next</Link></nav></div>
    {rows.length === 0 ? <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-12 text-center"><p className="font-medium text-slate-700">No work in this queue</p><p className="mt-1 text-sm text-slate-500">Try Team view or create a new lead.</p></div> : GROUPS.map(group => {
      const items = pageRows.filter(row => row.derived.dueStatus === group);
      if (!items.length) return null;
      return <section key={group} aria-label={GROUP_LABELS[group]} className="mb-6">
        <div className="space-y-3 md:hidden">{items.map(row => <article key={row.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><QuickEditLead lead={row} consultants={consultants} trigger="name"/><div className="mt-0.5 text-xs text-slate-500">{row.lead_ref} · {names.get(row.derived.currentOwnerId ?? "") ?? "Unassigned"}</div></div>{row.latest_quote_cents ? <span className="shrink-0 text-sm font-semibold">{formatSGD(row.latest_quote_cents)}</span> : null}</div><div className="mt-3 rounded-lg bg-slate-50 p-3"><div className="text-xs font-medium uppercase tracking-wide text-slate-500">Next action</div><div className="mt-1 font-medium text-slate-900">{row.derived.actionRequired}</div>{row.action_detail && <p className="mt-1 text-sm text-slate-600">{row.action_detail}</p>}</div><div className="mt-3 flex items-center justify-between gap-3 text-sm"><span className="text-slate-600">{row.funnel_stage}</span><span className="font-medium text-slate-700">{row.next_action_date_text ?? "No date"}</span></div><div className="mt-4 grid grid-cols-2 gap-2"><QuickEditLead lead={row} consultants={consultants} trigger="view" fullWidth/><QuickEditLead lead={row} consultants={consultants} fullWidth/></div></article>)}</div>
        <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm md:block"><table className="w-full min-w-[1580px] text-sm"><thead><tr className="border-b bg-slate-50/70 text-left text-slate-600">{["Customer", "Action", "Stage", "Detail", "Next date", "Move-in / days", "Quote", "Last contact", "Owner", "Actions"].map(label => <th className="p-3 font-medium" key={label}>{label}</th>)}</tr></thead><tbody>{items.map(row => <EditableLeadRow key={row.id} lead={row} consultants={consultants} variant="work" ownerName={row.derived.currentOwnerId ? names.get(row.derived.currentOwnerId) ?? "Unknown" : "Unassigned"} actionLabel={row.derived.actionRequired} moveInDisplay={row.move_in_date_text ? `${row.move_in_date_text} (${row.derived.daysToMoveIn}d)` : "—"} lastContactText={row.last_contact_at ? new Date(row.last_contact_at).toLocaleDateString("en-SG") : "—"}/> )}</tbody></table></div>
      </section>;
    })}
    <nav aria-label="Work queue pagination" className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm text-slate-500">Showing {rows.length === 0 ? 0 : (page - 1) * pageSize + 1}–{Math.min(page * pageSize, rows.length)} of {rows.length}</p><div className="flex flex-wrap items-center justify-end gap-1"><div className="flex items-center gap-1 text-xs text-slate-500"><span className="mr-1">Rows</span>{[10,25,50].map(size => <Link key={size} href={pageSizeHref(size)} className={`rounded-md px-2 py-1.5 font-medium ${pageSize === size ? "bg-slate-900 text-white" : "hover:bg-slate-100"}`}>{size}</Link>)}</div><Link aria-disabled={page === 1} tabIndex={page === 1 ? -1 : undefined} className={`inline-flex h-9 items-center justify-center rounded-lg border px-3 text-sm font-medium ${page === 1 ? "pointer-events-none border-slate-200 text-slate-300" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`} href={pageHref(Math.max(1, page - 1))}>Previous</Link><span className="min-w-20 text-center text-sm text-slate-600">Page {page} of {pageCount}</span><Link aria-disabled={page === pageCount} tabIndex={page === pageCount ? -1 : undefined} className={`inline-flex h-9 items-center justify-center rounded-lg border px-3 text-sm font-medium ${page === pageCount ? "pointer-events-none border-slate-200 text-slate-300" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`} href={pageHref(Math.min(pageCount, page + 1))}>Next</Link></div></nav>
  </>;
}
