import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "kysely";

import { AppointmentCard } from "@/components/leads/appointment-card";
import { BookAppointmentDialog } from "@/components/leads/book-appointment-dialog";
import { LogUpdateForm, RecommendationBanner } from "@/components/leads/phase16-forms";
import { requireRole } from "@/lib/auth/require-role";
import { isCalendarConfigured } from "@/lib/calendar/google";
import { db } from "@/lib/db/kysely";
import { deriveLead } from "@/lib/leads/funnel-engine";
import { todayInSingapore, toSgDate, type SgDate } from "@/lib/leads/sg-date";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ leadId: string }> }) {
  await requireRole(["consultant", "admin"]);
  const id = (await params).leadId;
  const lead = await db.selectFrom("leads").selectAll().select([
    sql<string | null>`next_action_date::text`.as("next_action_date_text"),
    sql<string | null>`move_in_date::text`.as("move_in_date_text"),
  ]).where("id", "=", id).executeTakeFirst();
  if (!lead) notFound();
  const profiles = await db.selectFrom("profiles").select(["id", "full_name", "is_presales_owner", "role", "is_active"]).execute();
  const presales = profiles.find(profile => profile.is_presales_owner)?.id ?? null;
  const names = new Map(profiles.map(profile => [profile.id, profile.full_name ?? "Unnamed"]));
  const derived = deriveLead({ ...lead, next_action_date: lead.next_action_date_text as SgDate | null, move_in_date: lead.move_in_date_text as SgDate | null, quotation_sent_at: lead.quotation_sent_at ? toSgDate(new Date(lead.quotation_sent_at)) : null }, todayInSingapore(), presales);
  const interactions = await db.selectFrom("lead_interactions").leftJoin("profiles", "profiles.id", "lead_interactions.created_by").select(["lead_interactions.id", "occurred_at", "direction", "interaction_type", "note", "profiles.full_name"]).where("lead_id", "=", id).orderBy("occurred_at", "desc").execute();
  const appointment = await db.selectFrom("appointments").selectAll().where("lead_id", "=", id).orderBy("created_at", "desc").executeTakeFirst();
  const consultants = profiles.filter(profile => profile.is_active && (profile.role === "consultant" || profile.role === "admin")).map(profile => ({ id: profile.id, full_name: profile.full_name }));
  const stats = [["Status", lead.lead_status], ["Action", derived.actionRequired], ["Due", derived.dueStatus], ["Readiness", derived.buyingReadiness ?? "—"], ["Owner", derived.currentOwnerId ? names.get(derived.currentOwnerId) ?? "Unknown" : "Unassigned"], ["Follow-ups", String(lead.unanswered_followups)]];

  return <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
    <Link href="/leads?view=work" className="mb-4 inline-flex text-sm font-medium text-slate-500 hover:text-slate-900">← Back to My Work</Link>
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><h1 className="break-words text-2xl font-bold">{lead.name}</h1><p className="text-slate-500">{lead.lead_ref} · {lead.mobile ?? "No mobile"}</p></div><Link href={`/leads/${id}/edit`} className="inline-flex h-10 w-fit shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50">Edit details</Link></div>
    <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">{stats.map(([label, value]) => <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm" key={label}><div className="text-xs font-medium text-slate-500">{label}</div><div className="mt-1 break-words text-sm font-semibold text-slate-900">{value}</div></div>)}</div>
    {derived.recommendations.length > 0 && <div className="mb-4 space-y-2">{derived.recommendations.map(recommendation => <RecommendationBanner key={recommendation.code} leadId={id} recommendation={recommendation}/>)}</div>}
    <section className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6"><div className="mb-4"><h2 className="font-semibold">Log update</h2><p className="mt-1 text-sm text-slate-500">Record what happened and set the next clear action.</p></div><LogUpdateForm key={new Date(lead.updated_at).toISOString()} lead={lead}/></section>
    <section className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6"><h2 className="mb-4 font-semibold">Appointment</h2>{appointment ? <AppointmentCard key={`${appointment.id}-${new Date(appointment.updated_at).toISOString()}`} appointment={appointment} calendarConfigured={isCalendarConfigured()}/> : <BookAppointmentDialog leadId={id} leadName={lead.name} leadMobile={lead.mobile} development={lead.development} consultants={consultants}/>}</section>
    <section className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6"><h2 className="mb-4 font-semibold">Timeline</h2>{interactions.length === 0 ? <p className="text-sm text-slate-500">No activity recorded yet.</p> : <div className="space-y-4">{interactions.map(interaction => <div key={interaction.id} className="border-l-2 border-slate-200 pl-3"><div className="text-sm font-medium">{interaction.interaction_type} {interaction.direction && `· ${interaction.direction}`}</div><div className="text-xs text-slate-500">{new Date(interaction.occurred_at).toLocaleString("en-SG")} · {interaction.full_name ?? "System"}</div>{interaction.note && <p className="mt-1 whitespace-pre-wrap text-sm">{interaction.note}</p>}</div>)}</div>}</section>
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><h2 className="font-semibold">Interaction summary</h2><p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{lead.interaction_summary ?? "No summary yet."}</p></section>
  </main>;
}
