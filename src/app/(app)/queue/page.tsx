import Link from "next/link";
import { sql } from "kysely";
import { requireRole } from "@/lib/auth/require-role";
import { db } from "@/lib/db/kysely";
import { deriveLead, STAGE_RANK } from "@/lib/leads/funnel-engine";
import { todayInSingapore, toSgDate, type SgDate } from "@/lib/leads/sg-date";
import { formatSGD } from "@/lib/money";
export const dynamic="force-dynamic"; export const metadata={title:"Daily Queue — Drapeworks CRM"};

export default async function Page({searchParams}:{searchParams:Promise<{owner?:string}>}){
  const session=await requireRole(["consultant","admin"]); const {owner}=await searchParams;
  const today=todayInSingapore();
  const profiles=await db.selectFrom("profiles").select(["id","full_name","is_presales_owner"]).execute();
  const presales=profiles.find(p=>p.is_presales_owner)?.id??null;
  const names=new Map(profiles.map(p=>[p.id,p.full_name??"Unnamed"]));
  const leads=await db.selectFrom("leads").selectAll().select([
    sql<string|null>`next_action_date::text`.as("next_action_date_text"),
    sql<string|null>`move_in_date::text`.as("move_in_date_text"),
  ]).where("is_archived","=",false).where("lead_status","in",["Active","Unresponsive"]).execute();
  const rows=leads.map(lead=>{
    const input={...lead,next_action_date:lead.next_action_date_text as SgDate|null,move_in_date:lead.move_in_date_text as SgDate|null,quotation_sent_at:lead.quotation_sent_at?toSgDate(new Date(lead.quotation_sent_at)):null};
    return {...lead,next_action_date:lead.next_action_date_text,move_in_date:lead.move_in_date_text,derived:deriveLead(input,today,presales)};
  }).filter(row=>row.derived.dueStatus==="Closed"||row.lead_status!=="Unresponsive"||(row.next_action_date_text!==null&&row.next_action_date_text<=today))
    .filter(row=>owner!=="mine"||row.derived.currentOwnerId===session.user.id)
    .sort((a,b)=>{const rank:Record<string,number>={Closed:-1,Overdue:0,"Due Today":1,Upcoming:2,"No Date":3};return rank[a.derived.dueStatus]-rank[b.derived.dueStatus]||STAGE_RANK[b.funnel_stage]-STAGE_RANK[a.funnel_stage]||String(a.next_action_date_text??"9999").localeCompare(String(b.next_action_date_text??"9999"))||(b.latest_quote_cents??0)-(a.latest_quote_cents??0)||a.name.localeCompare(b.name)||a.id.localeCompare(b.id)});
  const groups=["Closed","Overdue","Due Today","Upcoming","No Date"] as const;
  const pipeline=rows.reduce((sum,row)=>sum+(row.latest_quote_cents??0),0);
  return <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
    <div className="flex flex-col sm:flex-row sm:justify-between gap-3 mb-6"><div><h1 className="text-2xl font-bold">Daily Queue</h1><p className="text-sm text-slate-500">{rows.length} leads · {rows.filter(r=>r.derived.dueStatus==="Due Today").length} due today · {rows.filter(r=>r.derived.dueStatus==="Overdue").length} overdue · {formatSGD(pipeline)} pipeline</p></div><div className="flex gap-2"><Link href="/queue" className={`border rounded px-3 py-2 ${owner!=="mine"?"bg-slate-900 text-white":""}`}>All</Link><Link href="/queue?owner=mine" className={`border rounded px-3 py-2 ${owner==="mine"?"bg-slate-900 text-white":""}`}>Mine</Link></div></div>
    {groups.map(group=>{const items=rows.filter(row=>row.derived.dueStatus===group);if(!items.length)return null;return <section key={group} className="mb-6"><h2 className="font-semibold mb-2">{group==="Closed"?"Needs closing":group==="No Date"?"Unscheduled":group} ({items.length})</h2><div className="overflow-x-auto bg-white border rounded-lg"><table className="w-full text-sm min-w-[1000px]"><thead><tr className="text-left border-b">{["Customer","Action","Stage","Detail","Next date","Move-in / days","Quote","Last contact","Owner"].map(label=><th className="p-3" key={label}>{label}</th>)}</tr></thead><tbody>{items.map(row=><tr key={row.id} className="border-b"><td className="p-3"><Link className="font-medium text-teal-700" href={`/leads/${row.id}`}>{row.name}</Link><div className="text-xs text-slate-500">{row.lead_ref}</div></td><td className="p-3">{row.derived.actionRequired}</td><td className="p-3">{row.funnel_stage}</td><td className="p-3">{row.action_detail??"—"}</td><td className="p-3">{row.next_action_date?String(row.next_action_date).slice(0,10):"—"}</td><td className="p-3">{row.move_in_date?`${String(row.move_in_date).slice(0,10)} (${row.derived.daysToMoveIn}d)`:"—"}</td><td className="p-3">{row.latest_quote_cents?formatSGD(row.latest_quote_cents):"—"}</td><td className="p-3">{row.last_contact_at?new Date(row.last_contact_at).toLocaleDateString("en-SG"):"—"}</td><td className="p-3">{row.derived.currentOwnerId?names.get(row.derived.currentOwnerId)??"Unknown":"Unassigned"}</td></tr>)}</tbody></table></div></section>})}
  </main>;
}
