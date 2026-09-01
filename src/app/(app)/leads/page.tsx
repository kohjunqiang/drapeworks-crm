import Link from "next/link";
import { parseLeadSort, sortLeadRows } from "@/lib/leads/workspace-sort";
import { LeadFilterToolbar } from "@/components/leads/filter-toolbar";
import { ACTION_FILTERS, DUE_FILTERS, validFilterDate } from "@/lib/leads/workspace-filters";
import { deriveActionRequired, deriveDueStatus } from "@/lib/leads/funnel-engine";
import { todayInSingapore, toSgDate, type SgDate } from "@/lib/leads/sg-date";
import { sql } from "kysely";
import { requireRole } from "@/lib/auth/require-role";
import { db } from "@/lib/db/kysely";
import { CONTACT_CHANNELS, FUNNEL_STAGES, LEAD_SOURCES, LEAD_STATUSES, LEAD_DIRECTIONS, LEAD_OUTCOMES, PRIMARY_PRODUCTS } from "@/lib/leads/funnel-types";
import { QuickEditLead } from "@/components/leads/phase16-forms";
import { EditableLeadRow } from "@/components/leads/editable-lead-row";
import { FunnelStagePill } from "@/components/leads/funnel-stage-pill";

export const dynamic = "force-dynamic";
export const metadata = { title: "Leads — Drapeworks CRM" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireRole(["consultant", "admin"]);
  const p = await searchParams;
  const today = todayInSingapore();
  const sort = parseLeadSort(p.sort);
  const sortDirection = sort === "initiated" ? (p.sort === "initiated" && p.order === "asc" ? "asc" : "desc") : p.order === "desc" ? "desc" : "asc";
  const actionFor = (row: { funnel_stage: Parameters<typeof deriveActionRequired>[0]["funnel_stage"]; last_outcome: Parameters<typeof deriveActionRequired>[0]["last_outcome"]; next_action_date_text: string | null }) => deriveActionRequired({ ...row, next_action_date: row.next_action_date_text as SgDate | null }, today);
  const view = p.view === "all" ? "all" : "work";
  const tabs = <nav aria-label="Lead workspace views" className="inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm"><Link href="/leads?view=all" className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${view === "all" ? "bg-slate-900 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"}`}>All Leads</Link><Link href="/leads?view=work" className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${view === "work" ? "bg-slate-900 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"}`}>Active Queue</Link></nav>;
  const toolbar = <div className="mb-6 flex items-center justify-between gap-3">{tabs}<Link className="inline-flex h-10 shrink-0 items-center justify-center rounded-lg bg-teal-600 px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-teal-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2" href="/leads/new">New Lead</Link></div>;
  const filterOwners = await db.selectFrom("profiles").select(["id", "full_name", "is_active"]).where("role", "in", ["consultant", "admin"]).orderBy("full_name").execute();
  const consultants = filterOwners.filter(person => person.is_active);
  let q = db.selectFrom("leads")
    .leftJoin("profiles as consultant", join => join.onRef("consultant.id", "=", sql<string>`coalesce(leads.assigned_consultant_id, leads.owner_id)`))
    .select(["leads.id", "leads.created_at", "first_initiated_at", "last_contact_at", "inbound_outbound", "lead_ref", "name", "mobile", "development", "funnel_stage", "lead_status", "last_outcome", "contact_channel", "source", "primary_product", "latest_quote_cents", "assigned_consultant_id", "owner_id", "action_detail", "closure_reason", "consultant.full_name as consultant_name", sql<string | null>`next_action_date::text`.as("next_action_date_text"), sql<string | null>`move_in_date::text`.as("move_in_date_text")])
    .where("is_archived", "=", false);
  if (view === "work") q = q.where("funnel_stage", "not in", ["Lost", "Not Qualified"]);
  if (p.owner === "unassigned") q = q.where("assigned_consultant_id", "is", null).where("owner_id", "is", null);
  else if (filterOwners.some(person => person.id === p.owner)) q = q.where(sql<string>`coalesce(leads.assigned_consultant_id, leads.owner_id)`, "=", p.owner!);
  if (p.q?.trim()) q = q.where(eb => eb.or([eb("name", "ilike", `%${p.q}%`), eb("mobile", "ilike", `%${p.q}%`), eb("development", "ilike", `%${p.q}%`), eb("lead_ref", "ilike", `%${p.q}%`)]));
  if (FUNNEL_STAGES.includes(p.stage as never)) q = q.where("funnel_stage", "=", p.stage as never);
  if (LEAD_STATUSES.includes(p.status as never)) q = q.where("lead_status", "=", p.status as never);
  if (CONTACT_CHANNELS.includes(p.channel as never)) q = q.where("contact_channel", "=", p.channel as never);
  if (LEAD_SOURCES.includes(p.source as never)) q = q.where("source", "=", p.source as never);
  if (PRIMARY_PRODUCTS.includes(p.product as never)) q = q.where("primary_product", "=", p.product as never);
  if (LEAD_DIRECTIONS.includes(p.direction as never)) q = q.where("inbound_outbound", "=", p.direction as never);
  if (LEAD_OUTCOMES.includes(p.outcome as never)) q = q.where("last_outcome", "=", p.outcome as never);
  if (p.detail?.trim()) q = q.where("action_detail", "ilike", `%${p.detail.trim()}%`);
  for (const [key, column] of [["created", "leads.created_at"], ["initiated", "first_initiated_at"], ["contact", "last_contact_at"], ["next", "next_action_date"]] as const) {
    const dateColumn = key === "next" ? sql<string>`${sql.ref(column)}::text` : sql<string>`(${sql.ref(column)} at time zone 'Asia/Singapore')::date::text`;
    if (validFilterDate(p[`${key}_from`])) q = q.where(dateColumn, ">=", p[`${key}_from`]!);
    if (validFilterDate(p[`${key}_to`])) q = q.where(dateColumn, "<=", p[`${key}_to`]!);
  }
  if (p.needs_review === "1") q = q.where("move_in_date", "is", null).where(sql<boolean>`exists(select 1 from lead_legacy_import x where x.lead_id=leads.id and x.buying_readiness is not null)`);
  if (p.needs_owner === "1") q = q.where("assigned_consultant_id", "is", null).where("owner_id", "is", null);
  // Derived action/due filters must be applied before counts and pagination.
  // Sort the complete SQL-filtered set before pagination, including initiation dates.
  const filterAction = ACTION_FILTERS.includes(p.action as never);
  const filterDue = DUE_FILTERS.includes(p.due as never);
  const derivedRows = (await q.orderBy("leads.created_at", "desc").orderBy("leads.id", "desc").execute()).filter(row => {
    const action = actionFor(row);
    return (!filterAction || action === p.action) && (!filterDue || deriveDueStatus(action, row.next_action_date_text, today) === p.due);
  });
  const sortedRows = sortLeadRows(derivedRows, sort, sortDirection, row => deriveDueStatus(actionFor(row), row.next_action_date_text, today));
  const createdLeadIndex = p.created ? sortedRows.findIndex(row => row.id === p.created) : -1;
  const orderedRows = createdLeadIndex > 0
    ? [sortedRows[createdLeadIndex], ...sortedRows.slice(0, createdLeadIndex), ...sortedRows.slice(createdLeadIndex + 1)]
    : sortedRows;
  const total = derivedRows.length;
  const statusCounts = LEAD_STATUSES.map(lead_status => ({ lead_status, count: derivedRows.filter(row => row.lead_status === lead_status).length }));
  const countStatus = (status: string) => statusCounts.find(row => row.lead_status === status)?.count ?? 0;
  const activeCount = countStatus("Active");
  const unresponsiveCount = countStatus("Unresponsive");
  const closedCount = total - activeCount - unresponsiveCount;
  const requestedPageSize = Number.parseInt(p.pageSize ?? "25", 10);
  const pageSize = [10, 25, 50].includes(requestedPageSize) ? requestedPageSize : 25;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const requestedPage = Number.parseInt(p.page ?? "1", 10);
  const page = Math.min(Math.max(Number.isFinite(requestedPage) ? requestedPage : 1, 1), pageCount);
  const rows = orderedRows.slice((page - 1) * pageSize, page * pageSize).map(row => ({ ...row, created_date_text: toSgDate(new Date(row.created_at)), initiated_date_text: row.first_initiated_at ? toSgDate(new Date(row.first_initiated_at)) : null, last_contact_date_text: row.last_contact_at ? toSgDate(new Date(row.last_contact_at)) : null }));
  const pageHref = (nextPage: number) => { const params = new URLSearchParams(Object.entries(p).filter((entry): entry is [string, string] => entry[1] !== undefined)); params.set("view", view); params.set("page", String(nextPage)); return `/leads?${params.toString()}`; };
  const pageSizeHref = (size: number) => { const params = new URLSearchParams(Object.entries(p).filter((entry): entry is [string, string] => entry[1] !== undefined && entry[0] !== "page")); params.set("view", view); params.set("pageSize", String(size)); return `/leads?${params.toString()}`; };
  const sortHref = (key: "next" | "due" | "initiated") => {
    const params = new URLSearchParams(Object.entries(p).filter((entry): entry is [string, string] => entry[1] !== undefined && entry[0] !== "page"));
    params.set("view", view); params.set("sort", key);
    params.set("order", sort === key ? sortDirection === "asc" ? "desc" : "asc" : key === "initiated" ? "desc" : "asc");
    return `/leads?${params.toString()}`;
  };
  const sortLabel = sort === "initiated" ? `Initiated: ${sortDirection === "desc" ? "latest" : "earliest"} first` : sort === "next" ? `Next action: ${sortDirection === "asc" ? "earliest" : "latest"} first` : `Due status: ${sortDirection === "asc" ? "most" : "least"} urgent first`;
  return <main className="max-w-[1880px] mx-auto px-4 sm:px-6 py-6 sm:py-8">
    <div className="mb-4"><h1 className="text-2xl font-bold">Leads</h1><p className="text-sm text-slate-500">{view === "work" ? "All leads except Lost and Not Qualified" : "Search and manage every lead"}</p></div>
    {toolbar}
    <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">{[{label:"Matching leads",value:total},{label:"Active",value:activeCount},{label:"Unresponsive",value:unresponsiveCount},{label:"Closed",value:closedCount}].map(stat=><div key={stat.label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="text-xs font-medium uppercase tracking-wide text-slate-500">{stat.label}</div><div className="mt-1 text-xl font-semibold text-slate-900">{stat.value}</div></div>)}</div>
    <LeadFilterToolbar key={JSON.stringify(p)} params={p} view={view} pageSize={pageSize} owners={filterOwners}/>
    <div className="mb-3 flex items-center justify-between gap-3"><h2 aria-label={`${total} matching leads`} className="text-sm font-semibold text-slate-600">{total}</h2><span className="text-xs text-slate-500">{sortLabel} · Page {page} of {pageCount}</span></div>
    <div aria-label="Lead sorting" className="mb-3 flex flex-wrap items-center gap-3 text-xs xl:hidden"><span>Sort:</span>{(["initiated", "next", "due"] as const).map(key => <Link key={key} href={sortHref(key)} className={sort === key ? "font-semibold text-teal-700 underline" : "text-slate-600"}>{key === "initiated" ? "Initiated Date" : key === "next" ? "Next Action Date" : "Due Status"}{sort === key ? sortDirection === "asc" ? " ↑" : " ↓" : ""}</Link>)}</div>
    {rows.length === 0 && <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-12 text-center"><p className="font-medium text-slate-700">No leads match these filters</p><p className="mt-1 text-sm text-slate-500">Adjust the filters or clear the search.</p></div>}<div className="grid gap-3 md:grid-cols-2 xl:hidden">{rows.map(row => <article key={row.id} className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <QuickEditLead lead={row} consultants={consultants} trigger="name"/>
      <div className="mt-1 text-xs text-slate-500">{row.lead_ref}</div>
      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">{[
        ["Inbound / Outbound", row.inbound_outbound ?? "—"],
        ["Initiated Date", row.initiated_date_text ?? "—"],
        ["Last Contact Date", row.last_contact_date_text ?? "—"],
        ["Funnel Stage", row.funnel_stage],
        ["Lead Status", row.lead_status],
        ["Last Contact Outcome", row.last_outcome ?? "—"],
        ["Action Required", actionFor(row)],
        ["Action Detail", row.action_detail ?? "—"],
        ["Next Action Date", row.next_action_date_text ?? "—"],
        ["Due Status", deriveDueStatus(actionFor(row), row.next_action_date_text, today)],
      ].map(([label, value]) => <div key={label} className="min-w-0 break-words"><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1">{label === "Funnel Stage" ? <FunnelStagePill stage={row.funnel_stage}/> : value}</dd></div>)}</dl>
      <div className="mt-4 grid grid-cols-2 gap-2"><QuickEditLead lead={row} consultants={consultants} trigger="view" fullWidth/><QuickEditLead lead={row} consultants={consultants} fullWidth/></div>
    </article>)}</div>
{rows.length > 0 &&     <div className="hidden rounded-xl border border-slate-200 bg-white shadow-sm xl:block"><table className="w-full table-fixed text-xs [&_th]:break-words"><colgroup>{[13,7,8,7,10,6,10,8,10,8,7,6].map((width, index) => <col key={index} style={{width: `${width}%`}}/>)}</colgroup><thead><tr className="border-b bg-slate-50/70 text-left text-slate-600">{["Customer Name", "Inbound / Outbound", "Initiated Date", "Last Contact Date", "Funnel Stage", "Lead Status", "Last Contact Outcome", "Action Required", "Action Detail", "Next Action Date", "Due Status", "Actions"].map((label, index) => {
  const key = index === 9 ? "next" : index === 10 ? "due" : index === 2 ? "initiated" : null;
  return <th className={`px-2 py-3 font-medium ${label === "Actions" ? "text-right" : ""}`} key={label} aria-sort={key && sort === key ? sortDirection === "desc" ? "descending" : "ascending" : undefined}>{key ? <Link href={sortHref(key)} className="inline-flex items-center gap-1 rounded hover:text-teal-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600" aria-label={`Sort by ${label}`}>{label}<span aria-hidden="true">{sort === key ? sortDirection === "desc" ? "↓" : "↑" : "↕"}</span></Link> : label}</th>;
})}</tr></thead><tbody>{rows.map(row => <EditableLeadRow key={row.id} lead={row} consultants={consultants} variant="all" actionLabel={actionFor(row)} dueLabel={deriveDueStatus(actionFor(row), row.next_action_date_text, today)} ownerName={row.consultant_name ?? "Unassigned"}/> )}</tbody></table></div>}
    <nav aria-label="Leads pagination" className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm text-slate-500">Showing {total === 0 ? 0 : (page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}</p><div className="flex flex-wrap items-center justify-end gap-1"><div className="flex items-center gap-1 text-xs text-slate-500"><span className="mr-1">Rows</span>{[10,25,50].map(size => <Link key={size} href={pageSizeHref(size)} className={`rounded-md px-2 py-1.5 font-medium ${pageSize === size ? "bg-slate-900 text-white" : "hover:bg-slate-100"}`}>{size}</Link>)}</div><Link aria-disabled={page === 1} tabIndex={page === 1 ? -1 : undefined} className={`inline-flex h-9 items-center justify-center rounded-lg border px-3 text-sm font-medium ${page === 1 ? "pointer-events-none border-slate-200 text-slate-300" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`} href={pageHref(Math.max(1, page - 1))}>Previous</Link><span className="min-w-20 text-center text-sm text-slate-600">Page {page} of {pageCount}</span><Link aria-disabled={page === pageCount} tabIndex={page === pageCount ? -1 : undefined} className={`inline-flex h-9 items-center justify-center rounded-lg border px-3 text-sm font-medium ${page === pageCount ? "pointer-events-none border-slate-200 text-slate-300" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`} href={pageHref(Math.min(pageCount, page + 1))}>Next</Link></div></nav>
  </main>;
}
