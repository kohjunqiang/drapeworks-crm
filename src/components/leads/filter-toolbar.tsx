"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FILTER_DATES, FILTER_SELECTS, selectedFilters, selectedFilterValues, columnFilterPills } from "@/lib/leads/workspace-filters";

const control = "mt-1 h-10 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 text-sm focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-100";
export function LeadFilterToolbar({ params, view, pageSize, owners }: { params: Record<string, string | undefined>; view: "all" | "work"; pageSize: number; owners: { id: string; full_name: string | null }[] }) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const router = useRouter();
  const filters = selectedFilters(params, owners);
  const pills = columnFilterPills(params, owners, view);
  const activeCount = pills.filter(pill => pill.keys.length).length;
  const clearHref = `/leads?view=${view}&pageSize=${pageSize}`;
  const removeHref = (keys: string[]) => {
    const next = new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => !!entry[1] && !keys.includes(entry[0]) && entry[0] !== "page"));
    next.set("view", view); next.set("pageSize", String(pageSize));
    return `/leads?${next.toString()}`;
  };
  return <section aria-label="Lead filters" className="mb-4 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
    <div className="flex h-10 items-center justify-between gap-3"><span className="min-w-0 truncate text-sm font-medium text-slate-700">{view === "all" && !filters.length ? "No filters applied" : "Applied filters"}</span>
      <button type="button" aria-expanded={expanded} aria-controls="lead-filter-summary" onClick={() => setExpanded(value => !value)} className="ml-auto h-10 shrink-0 rounded-lg px-2 text-sm text-slate-600 hover:bg-slate-50">{expanded ? "Show less" : "Show more"}</button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger className="inline-flex h-10 shrink-0 items-center rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium hover:bg-slate-50">Filters{activeCount ? ` (${activeCount})` : ""}</DialogTrigger>
        <DialogContent className="sm:max-w-2xl">
          <DialogTitle>Filter leads</DialogTitle><DialogDescription>Choose any combination. All means that field is not filtered.</DialogDescription>
          <form onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); const next = new URLSearchParams(); for (const [key, value] of data) if (key !== "stage" && typeof value === "string" && value.trim()) next.set(key, value.trim()); const stages = data.getAll("stage").filter((value): value is string => typeof value === "string" && !!value); if (stages.length) next.set("stage", stages.join(",")); next.set("view", view); next.set("pageSize", String(pageSize)); router.push(`/leads?${next.toString()}`); setOpen(false); }}>
            <input type="hidden" name="sort" value={params.sort ?? "newest"}/>
            <input type="hidden" name="order" value={params.order ?? "asc"}/>
            {view === "work" && <p className="mb-4 rounded-lg bg-teal-50 p-3 text-sm text-teal-800">Active Queue preset: Funnel Stage excludes Lost and Not Qualified. Switch to All Leads to include them.</p>}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="min-w-0 text-sm">Customer Name / Search<input name="q" defaultValue={params.q} className={control} placeholder="Name, mobile, reference or development"/></label>
              <label className="min-w-0 text-sm">Action Detail<input name="detail" defaultValue={params.detail} className={control}/></label>
              {FILTER_SELECTS.map(field => field.key === "stage" ? <fieldset key={field.key} className="min-w-0 rounded-lg border border-slate-200 p-3 sm:col-span-2"><legend className="px-1 text-sm font-medium">Funnel Stage <span className="font-normal text-slate-500">(select one or more)</span></legend><div className="mt-1 grid gap-2 sm:grid-cols-2">{field.values.filter(value => view !== "work" || (value !== "Lost" && value !== "Not Qualified")).map(value => <label key={value} className="flex min-w-0 items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-slate-50"><input type="checkbox" name="stage" value={value} defaultChecked={selectedFilterValues(params.stage, field.values).includes(value)} className="mt-0.5"/><span>{value}</span></label>)}</div><p className="mt-2 text-xs text-slate-500">No selection shows {view === "work" ? "every active-queue stage" : "all stages"}.</p></fieldset> : <label key={field.key} className="min-w-0 text-sm">{field.label}<select name={field.key} defaultValue={params[field.key] ?? ""} className={control}><option value="">All</option>{field.values.map(value => <option key={value} value={value}>{value === "Curtains / Blinds" ? "Curtains & Blinds" : value === "Both" ? "Both (legacy)" : value}</option>)}</select></label>)}
              <label className="min-w-0 text-sm">Owner<select name="owner" defaultValue={params.owner ?? ""} className={control}><option value="">All</option><option value="unassigned">Unassigned</option>{owners.map(person => <option key={person.id} value={person.id}>{person.full_name ?? "Unnamed"}</option>)}</select></label>
              {FILTER_DATES.map(field => <fieldset key={field.key} className="min-w-0 sm:col-span-2"><legend className="text-sm font-medium">{field.label}</legend><div className="grid grid-cols-2 gap-3">{["from", "to"].map(bound => <label key={bound} className="min-w-0 text-xs text-slate-500">{bound === "from" ? "From" : "To"}<input aria-label={`${field.label} ${bound}`} name={`${field.key}_${bound}`} type="date" defaultValue={params[`${field.key}_${bound}`]} className={control}/></label>)}</div></fieldset>)}
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="needs_review" value="1" defaultChecked={params.needs_review === "1"}/>Needs review</label>
              {params.needs_owner === "1" && <input type="hidden" name="needs_owner" value="1"/>}
            </div>
            <div className="sticky bottom-0 mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 bg-white py-3"><Link href={clearHref} onClick={() => setOpen(false)} className="mr-auto text-sm text-slate-600">Clear filters</Link><button type="button" onClick={() => setOpen(false)} className="h-10 rounded-lg border px-4 text-sm">Cancel</button><button className="h-10 rounded-lg bg-slate-900 px-4 text-sm font-medium text-white">Apply filters</button></div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
    <div id="lead-filter-summary" className={`mt-3 flex min-h-10 items-center gap-2 ${expanded ? "flex-wrap" : ""}`}>
      {(expanded ? pills : [...pills.filter(pill => pill.preset || pill.keys.length), ...pills.filter(pill => !pill.preset && !pill.keys.length)].slice(0, 1)).map(pill => <div key={pill.key} className={`inline-flex h-9 min-w-0 max-w-full shrink-0 items-center rounded-lg border text-xs ${pill.preset || pill.keys.length ? "border-teal-200 bg-teal-50 text-teal-900" : "border-slate-200 bg-slate-50 text-slate-600"}`}>
        <button type="button" onClick={() => setOpen(true)} aria-label={`Filter ${pill.label}`} title={`${pill.label}: ${pill.value}`} className="min-w-0 truncate px-3 py-2 text-left"><span className="font-medium">{pill.label}:</span> {pill.value}</button>
        {!!pill.keys.length && <Link href={removeHref(pill.keys)} aria-label={`Remove ${pill.label} filter`} className="py-2 pr-3">×</Link>}
      </div>)}
      {expanded && !!filters.length && <Link href={clearHref} className="text-xs text-slate-500 underline">Clear filters</Link>}
    </div>
  </section>;
}
