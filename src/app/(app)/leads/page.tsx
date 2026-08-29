import Link from "next/link";
import { sql } from "kysely";
import { requireRole } from "@/lib/auth/require-role";
import { db } from "@/lib/db/kysely";
import { CONTACT_CHANNELS, FUNNEL_STAGES, LEAD_SOURCES, LEAD_STATUSES, PRIMARY_PRODUCTS } from "@/lib/leads/funnel-types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Leads — Drapeworks CRM" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireRole(["consultant", "admin"]);
  const p = await searchParams;
  let q = db.selectFrom("leads")
    .leftJoin("profiles as consultant", "consultant.id", "leads.assigned_consultant_id")
    .select(["leads.id", "lead_ref", "name", "mobile", "funnel_stage", "lead_status", "last_outcome", "contact_channel", "source", "primary_product", "latest_quote_cents", "consultant.full_name as consultant_name", sql<string | null>`next_action_date::text`.as("next_action_date_text")])
    .where("is_archived", "=", false);
  if (p.q && p.q.length >= 2) q = q.where(eb => eb.or([eb("name", "ilike", `%${p.q}%`), eb("mobile", "ilike", `%${p.q}%`), eb("development", "ilike", `%${p.q}%`), eb("lead_ref", "ilike", `%${p.q}%`)]));
  if (FUNNEL_STAGES.includes(p.stage as never)) q = q.where("funnel_stage", "=", p.stage as never);
  if (LEAD_STATUSES.includes(p.status as never)) q = q.where("lead_status", "=", p.status as never);
  if (CONTACT_CHANNELS.includes(p.channel as never)) q = q.where("contact_channel", "=", p.channel as never);
  if (LEAD_SOURCES.includes(p.source as never)) q = q.where("source", "=", p.source as never);
  if (PRIMARY_PRODUCTS.includes(p.product as never)) q = q.where("primary_product", "=", p.product as never);
  if (p.needs_review === "1") q = q.where("move_in_date", "is", null).where(sql<boolean>`exists(select 1 from lead_legacy_import x where x.lead_id=leads.id and x.buying_readiness is not null)`);
  const rows = await q.orderBy("name").execute();
  const select = (name: string, label: string, values: readonly string[]) => <select name={name} defaultValue={p[name] ?? ""} className="h-9 rounded border px-2 text-sm"><option value="">{label}</option>{values.map(value => <option key={value}>{value}</option>)}</select>;
  return <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
    <div className="flex justify-between mb-5"><div><h1 className="text-2xl font-bold">Leads</h1><p className="text-sm text-slate-500">{rows.length} records</p></div><Link className="bg-teal-600 text-white rounded px-4 py-2" href="/leads/new">New Lead</Link></div>
    <form className="bg-white border rounded-lg p-3 flex flex-col lg:flex-row gap-2 mb-4"><input name="q" defaultValue={p.q} placeholder="Search leads" className="h-9 rounded border px-3 flex-1"/>{select("stage", "All stages", FUNNEL_STAGES)}{select("status", "All statuses", LEAD_STATUSES)}{select("channel", "All channels", CONTACT_CHANNELS)}{select("source", "All sources", LEAD_SOURCES)}{select("product", "All products", PRIMARY_PRODUCTS)}<label className="h-9 flex items-center gap-2 px-2 text-sm whitespace-nowrap"><input type="checkbox" name="needs_review" value="1" defaultChecked={p.needs_review === "1"}/>Needs review</label><button className="h-9 px-3 rounded bg-slate-900 text-white">Filter</button></form>
    <div className="overflow-x-auto bg-white border rounded-lg"><table className="w-full text-sm min-w-[900px]"><thead><tr className="text-left border-b">{["Customer", "Stage", "Status", "Outcome", "Owner", "Channel", "Source", "Next action", "Quote"].map(label => <th className="p-3" key={label}>{label}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.id} className="border-b"><td className="p-3"><Link className="font-medium text-teal-700" href={`/leads/${row.id}`}>{row.name}</Link><div className="text-xs text-slate-500">{row.lead_ref}</div></td><td className="p-3">{row.funnel_stage}</td><td className="p-3">{row.lead_status}</td><td className="p-3">{row.last_outcome ?? "—"}</td><td className="p-3">{row.consultant_name ?? "Pre-sales"}</td><td className="p-3">{row.contact_channel}</td><td className="p-3">{row.source ?? "—"}</td><td className="p-3">{row.next_action_date_text ?? "—"}</td><td className="p-3">{row.latest_quote_cents ? `$${(row.latest_quote_cents / 100).toFixed(2)}` : "—"}</td></tr>)}</tbody></table></div>
  </main>;
}
