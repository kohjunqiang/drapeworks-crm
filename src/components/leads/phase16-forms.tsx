"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { acceptRecommendation, archiveLead, createLead, getLeadModalData, dismissRecommendation, editLeadDetails, logLeadUpdate, quickEditLead } from "@/lib/actions/leads";
import { CLOSURE_REASONS, CONTACT_CHANNELS, FUNNEL_STAGES, INTERACTION_TYPES, LEAD_DIRECTIONS, LEAD_OUTCOMES, LEAD_SOURCES, SELECTABLE_PRIMARY_PRODUCTS, type FunnelStage, type Recommendation } from "@/lib/leads/funnel-types";

const controlClass = "h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100";
const Select = ({ name, defaultValue, children, required = false }: { name: string; defaultValue?: string | null; children: ReactNode; required?: boolean }) => <select name={name} defaultValue={defaultValue ?? ""} required={required} className={controlClass}>{children}</select>;
const Field = ({ label, hint, children, className = "" }: { label: string; hint?: string; children: ReactNode; className?: string }) => <label className={`block min-w-0 ${className}`}><span className="mb-1.5 block text-sm font-medium text-slate-700">{label}</span>{children}{hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}</label>;
const options = (values: readonly string[]) => <>{values.map(value => <option key={value} value={value}>{value === "Curtains / Blinds" ? "Curtains & Blinds" : value}</option>)}</>;

function useSubmit<Result>(action: (value: Record<string, FormDataEntryValue>) => Promise<Result>, onSuccess?: (result: Result) => void | Promise<void>, successMessage = "Saved") {
  const [pending, start] = useTransition();
  const router = useRouter();
  return { pending, submit: (form: HTMLFormElement) => start(async () => { try { const result = await action(Object.fromEntries(new FormData(form))); toast.success(successMessage); await onSuccess?.(result); router.refresh(); } catch (error) { toast.error(error instanceof Error ? error.message : "Save failed"); } }) };
}

export function QuickEditLead({ lead: initialLead, consultants, fullWidth = false, trigger = "edit" }: { lead: { inbound_outbound?: string | null; created_date_text?: string; initiated_date_text?: string | null; last_contact_date_text?: string | null; id: string; name: string; funnel_stage: FunnelStage; lead_status?: string; mobile?: string | null; development?: string | null; contact_channel?: string; source?: string | null; primary_product?: string | null; next_action_date_text: string | null; move_in_date_text?: string | null; action_detail: string | null; latest_quote_cents?: number | null; closure_reason?: string | null; assigned_consultant_id: string | null; owner_id: string | null }; consultants: { id: string; full_name: string | null }[]; fullWidth?: boolean; trigger?: "view" | "edit" | "name" | "advanced" }) {
  const [detailData, setDetailData] = useState<Awaited<ReturnType<typeof getLeadModalData>> | null>(null);
  const [loading, setLoading] = useState(false);
  const [logging, setLogging] = useState(false);
  const [dirty, setDirty] = useState(false);
  const lead = detailData?.lead ?? initialLead;
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(trigger === "edit");
  const [stage, setStage] = useState(lead.funnel_stage);
  const state = useSubmit(quickEditLead, () => setOpen(false));
  const ownerName = detailData?.ownerName ?? consultants.find(person => person.id === (lead.assigned_consultant_id ?? lead.owner_id))?.full_name ?? "Unassigned";
  const openModal = async () => { setLoading(true); try { const data = await getLeadModalData(initialLead.id); setDetailData(data); setLogging(false); setDirty(false); setEditing(trigger === "edit" || trigger === "advanced"); setStage(data.lead.funnel_stage); setOpen(true); } catch { toast.error("Could not load lead details. Please try again."); } finally { setLoading(false); } };
  const triggerClass = trigger === "name" ? "block max-w-full truncate text-left font-medium text-teal-700 hover:underline" : `inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white font-medium text-slate-700 hover:bg-slate-50 ${fullWidth ? "h-10 w-full text-sm" : "h-8 px-3 text-xs"}`;
  return <><button type="button" onClick={openModal} disabled={loading} aria-busy={loading} title={initialLead.name} className={triggerClass}>{trigger === "name" ? initialLead.name : trigger === "view" ? "View" : trigger === "advanced" ? "Advanced" : "Edit"}</button>{open && <div role="dialog" aria-modal="true" aria-label={`${editing ? "Edit" : "View"} ${lead.name}`} className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-3 sm:items-center" onMouseDown={event => { if (event.target === event.currentTarget) setOpen(false); }}><div className="max-h-[90vh] w-full max-w-4xl space-y-4 overflow-y-auto rounded-2xl bg-white p-5 text-left shadow-xl">{logging && detailData ? <><div className="flex items-center justify-between"><h2 className="font-semibold">Log interaction · {lead.name}</h2><Button type="button" variant="outline" onClick={() => { if (dirty && !window.confirm("Discard this unsaved interaction?")) return; setDirty(false); setLogging(false); }}>Back to lead</Button></div><LogUpdateForm lead={detailData.lead} onDirty={() => setDirty(true)} onSuccess={async () => { const data = await getLeadModalData(initialLead.id); setDetailData(data); setStage(data.lead.funnel_stage); setEditing(false); setDirty(false); setLogging(false); }}/></> : <form onChange={() => setDirty(true)} onSubmit={event => { event.preventDefault(); state.submit(event.currentTarget); }} className="space-y-4"><input type="hidden" name="id" value={lead.id}/><input type="hidden" name="expected_updated_at" value={detailData ? new Date(detailData.lead.updated_at).toISOString() : ""}/><div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold text-slate-900">{editing ? "Edit lead" : lead.name}</h2><p className="mt-0.5 text-sm text-slate-500">{editing ? lead.name : `${lead.funnel_stage} · ${lead.lead_status ?? "Lead"}`}</p></div><button type="button" onClick={() => setOpen(false)} className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100" aria-label="Close lead modal">×</button></div>{editing ? <><div className="grid gap-4 sm:grid-cols-2"><Field label="Customer"><Input name="name" required defaultValue={lead.name}/></Field><Field label="Owner"><Select name="owner_id" required defaultValue={lead.assigned_consultant_id ?? lead.owner_id ?? ""}><option value="">Select owner</option>{consultants.map(person => <option key={person.id} value={person.id}>{person.full_name ?? "Unnamed"}</option>)}</Select></Field><Field label="Stage"><select name="funnel_stage" value={stage} onChange={event => setStage(event.target.value as FunnelStage)} className={controlClass}>{options(FUNNEL_STAGES)}</select></Field>{(stage === "Lost" || stage === "Not Qualified") && <Field label="Closure reason"><Select name="closure_reason" required defaultValue={lead.closure_reason ?? ""}><option value="">Select reason</option>{options(CLOSURE_REASONS)}</Select></Field>}<Field label="Last contact outcome"><Select name="last_outcome" defaultValue={detailData?.lead.last_outcome ?? ""}><option value="">No outcome</option>{options(LEAD_OUTCOMES)}</Select></Field><Field label="Next action date"><Input name="next_action_date" type="date" defaultValue={lead.next_action_date_text ?? ""}/></Field><Field label="Move-in date"><Input name="move_in_date" type="date" defaultValue={lead.move_in_date_text ?? ""}/></Field><Field label="Latest Quotation Value (SGD)"><Input name="latest_quote_sgd" type="number" min="0" step="0.01" defaultValue={lead.latest_quote_cents != null ? lead.latest_quote_cents / 100 : ""}/></Field><Field label="Action Detail" className="sm:col-span-2"><Textarea name="action_detail" defaultValue={lead.action_detail ?? ""} placeholder="What happens next?"/></Field><p className="sm:col-span-2 text-xs text-slate-500">Action and status update automatically from the workflow. Last contact comes from the interaction timeline.</p></div><div className="grid gap-4 border-t border-slate-100 pt-4 sm:grid-cols-2"><Field label="Keys Collected"><Select name="keys_collected" defaultValue={detailData?.lead.keys_collected == null ? "" : String(detailData.lead.keys_collected)}><option value="">Unknown</option><option value="true">Yes</option><option value="false">No</option></Select></Field><Field label="Interaction Summary" className="sm:col-span-2"><Textarea name="interaction_summary" defaultValue={detailData?.lead.interaction_summary ?? ""}/></Field><Field label="Quotation Breakdown" className="sm:col-span-2"><Textarea name="quotation_breakdown" defaultValue={detailData?.lead.quotation_breakdown ?? ""}/></Field><Field label="Historical Summary" className="sm:col-span-2"><Textarea name="historical_summary" defaultValue={detailData?.lead.historical_summary ?? ""}/></Field><Field label="Mobile"><Input name="mobile" defaultValue={lead.mobile ?? ""}/></Field><Field label="Development"><Input name="development" defaultValue={lead.development ?? ""}/></Field>{lead.inbound_outbound !== undefined && <Field label="Inbound / Outbound"><div className="flex h-10 items-center rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-600">{lead.inbound_outbound ?? "Unknown"}</div></Field>}<Field label="Contact channel"><Select name="contact_channel" defaultValue={lead.contact_channel ?? "Other"}>{options(CONTACT_CHANNELS)}</Select></Field><Field label="Source"><Select name="source" defaultValue={lead.source ?? ""}><option value="">Unknown</option>{options(LEAD_SOURCES)}</Select></Field><Field label="Primary product" className="sm:col-span-2"><Select name="primary_product" defaultValue={lead.primary_product ?? ""}><option value="">Unknown</option>{lead.primary_product === "Both" && <option value="Both">Both (legacy — choose one to change)</option>}{options(SELECTABLE_PRIMARY_PRODUCTS)}</Select></Field></div></> : null}<><dl className="grid gap-4 rounded-xl bg-slate-50 p-4 sm:grid-cols-2 lg:grid-cols-3">{[
["Lead Reference", detailData?.lead.lead_ref ?? "—"],
["Created Date", detailData?.lead.created_date_text ?? "—"],
["Initiated Date", detailData?.lead.initiated_date_text ?? "—"],
["Last Contact Date", detailData?.lead.last_contact_date_text ?? "—"],
["Inbound / Outbound", lead.inbound_outbound ?? "—"],
["Owner", ownerName], ["Mobile", lead.mobile ?? "—"], ["Development", lead.development ?? "—"],
["Channel", lead.contact_channel ?? "—"], ["Source", lead.source ?? "—"], ["Product", lead.primary_product ?? "—"],
["Funnel Stage", lead.funnel_stage], ["Lead Status", lead.lead_status ?? "—"],
["Last Contact Outcome", detailData?.lead.last_outcome ?? "—"],
["Latest Quotation Value", lead.latest_quote_cents != null ? new Intl.NumberFormat("en-SG", { style: "currency", currency: "SGD" }).format(lead.latest_quote_cents / 100) : "—"],
["Buying Readiness", detailData?.lead.buying_readiness ?? "—"],
["Keys Collected", detailData?.lead.keys_collected == null ? "Unknown" : detailData.lead.keys_collected ? "Yes" : "No"],
["Move-In Date", lead.move_in_date_text ?? "—"],
["Days to Move-In", detailData?.lead.days_to_move_in == null ? "—" : String(detailData.lead.days_to_move_in)],
["Last Customer Response Date", detailData?.lead.last_response_date_text ?? "—"],
["Last Message By", detailData?.lead.last_message_by === "Inbound" ? "Customer (Inbound)" : detailData?.lead.last_message_by === "Outbound" ? "Team (Outbound)" : "—"],
["Closure Reason", lead.closure_reason ?? "—"],
["Follow-Up Attempts", String(detailData?.lead.unanswered_followups ?? 0)],
["Next Action Date", lead.next_action_date_text ?? "—"],
["Action Detail", lead.action_detail ?? "—"],
["Action Required", detailData?.lead.action_required ?? "—"],
["Due Status", detailData?.lead.due_status ?? "—"],
].filter(([label]) => !editing || ["Lead Reference", "Created Date", "Initiated Date", "Last Contact Date", "Lead Status", "Last Contact Outcome", "Buying Readiness", "Days to Move-In", "Last Customer Response Date", "Last Message By", "Follow-Up Attempts", "Action Required", "Due Status"].includes(label) || (label === "Closure Reason" && stage !== "Lost" && stage !== "Not Qualified")).map(([label,value]) => <div key={label} className="min-w-0"><dt className="text-xs font-medium text-slate-500">{label}</dt><dd className="mt-1 break-words text-sm text-slate-900">{value}</dd></div>)}</dl>
{!editing && [["Interaction Summary", detailData?.lead.interaction_summary], ["Historical Summary", detailData?.lead.historical_summary], ["Latest Quotation Note", detailData?.lead.latest_quote_note], ["Quotation Breakdown", detailData?.lead.quotation_breakdown]].map(([label,value]) => <section key={label}><h3 className="text-sm font-semibold">{label}</h3><p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-600">{value || "—"}</p></section>)}
<section><h3 className="mb-3 text-sm font-semibold">Interactions</h3>{detailData?.interactions.length ? <ol className="space-y-3">{detailData.interactions.map(item => <li key={item.id} className="border-l-2 border-teal-200 pl-3"><div className="text-sm font-medium">{item.interaction_type}{item.direction ? ` · ${item.direction}` : ""}</div><div className="text-xs text-slate-500">{new Date(item.occurred_at).toLocaleString("en-SG", { timeZone: "Asia/Singapore" })} · {item.full_name ?? "System"}</div><p className="mt-1 whitespace-pre-wrap break-words text-sm">{item.note ?? "—"}</p></li>)}</ol> : <p className="text-sm text-slate-500">No interactions recorded.</p>}</section></><div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between"><Button type="button" variant="outline" disabled={state.pending} onClick={() => { if (dirty && !window.confirm("Discard unsaved edits and log an interaction?")) return; setDirty(false); setStage(lead.funnel_stage); setLogging(true); }}>Log interaction</Button><div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setOpen(false)}>Close</Button>{editing ? <Button type="submit" disabled={state.pending}>{state.pending ? "Saving…" : "Save"}</Button> : <Button type="button" onClick={() => setEditing(true)}>Edit</Button>}</div></div></form>}</div></div>}</>;
}

export function NewLeadForm({ initialInitiatedDate }: { initialInitiatedDate: string }) {
  const router = useRouter();
  const state = useSubmit(
    createLead,
    ({ id }) => router.push(`/leads?view=work&created=${encodeURIComponent(id)}`),
    "Lead created",
  );
  return <form onSubmit={event => { event.preventDefault(); state.submit(event.currentTarget); }} className="space-y-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
    <div><h2 className="font-semibold">Customer and source</h2><p className="mt-1 text-sm text-slate-500">Add what you know now. Optional details can be completed later.</p></div>
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Customer name"><Input name="name" placeholder="e.g. Jane Tan" required/></Field>
      <Field label="Mobile"><Input name="mobile" inputMode="tel" placeholder="e.g. 9123 4567"/></Field>
      <Field label="Development"><Input name="development" placeholder="Property or development"/></Field>
      <Field label="Contact channel"><Select name="contact_channel" required><option value="">Select channel</option>{options(CONTACT_CHANNELS)}</Select></Field>
      <Field label="Lead source"><Select name="source"><option value="">Select source</option>{options(LEAD_SOURCES)}</Select></Field>
      <Field label="Direction"><Select name="inbound_outbound"><option value="">Select direction</option>{options(LEAD_DIRECTIONS)}</Select></Field>
      <Field label="Primary product"><Select name="primary_product"><option value="">Select product</option>{options(SELECTABLE_PRIMARY_PRODUCTS)}</Select></Field>
      <Field label="Initiated date"><Input name="first_initiated_date" type="date" required defaultValue={initialInitiatedDate}/></Field>
    </div>
    <Field label="Interaction summary" hint="A short handover note describing the conversation so far."><Textarea name="interaction_summary" placeholder="What does the customer need, and what has already happened?"/></Field>
    <div className="flex justify-end"><Button className="h-10 w-full px-5 sm:w-auto" type="submit" disabled={state.pending}>{state.pending ? "Creating…" : "Create lead"}</Button></div>
  </form>;
}

export function LogUpdateForm({ lead, onSuccess, onDirty }: { onDirty?: () => void; onSuccess?: () => void | Promise<void>; lead: { updated_at: Date | string; next_action_date_text?: string | null; closure_reason?: string | null; id: string; funnel_stage: FunnelStage; interaction_summary: string | null; action_detail: string | null; quote_valid_days: number } }) {
  const [stage, setStage] = useState(lead.funnel_stage);
  const [seenStage, setSeenStage] = useState(lead.funnel_stage);
  const [outcome, setOutcome] = useState("");
  const [interactionType, setInteractionType] = useState("Reply");
  const [direction, setDirection] = useState("Outbound");
  if (lead.funnel_stage !== seenStage) { setSeenStage(lead.funnel_stage); setStage(lead.funnel_stage); }
  const state = useSubmit(logLeadUpdate, onSuccess);
  const selectOutcome = (value: string) => {
    setOutcome(value);
    const defaults: Record<string, [string, string]> = { "Customer Replied": ["Customer Message", "Inbound"], "Awaiting Customer": ["Reply", "Outbound"], "No Response": ["Follow-Up", "Outbound"], "Pre-Appointment Barrier": ["Customer Message", "Inbound"], "Appointment Booked": ["Appointment", "Outbound"], "Quotation Sent": ["Quote", "Outbound"], "Post-Appointment Barrier": ["Customer Message", "Inbound"], "Customer Declined": ["Customer Message", "Inbound"], "Customer Confirmed": ["Customer Message", "Inbound"] };
    const next = defaults[value]; if (next) { setInteractionType(next[0]); setDirection(next[1]); }
  };
  return <form onChange={onDirty} onSubmit={event => { event.preventDefault(); state.submit(event.currentTarget); }} className="space-y-5">
    <input type="hidden" name="lead_id" value={lead.id}/><input type="hidden" name="expected_updated_at" value={new Date(lead.updated_at).toISOString()}/>
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Customer outcome"><select name="last_outcome" required value={outcome} onChange={event => selectOutcome(event.target.value)} className={controlClass}><option value="">Select what happened</option>{options(LEAD_OUTCOMES)}</select></Field>
      <Field label="Interaction type"><select name="interaction_type" value={interactionType} onChange={event => setInteractionType(event.target.value)} className={controlClass}>{options(INTERACTION_TYPES)}</select></Field>
      <Field label="Direction"><select name="direction" value={direction} onChange={event => setDirection(event.target.value)} className={controlClass}><option value="">No direction</option>{options(LEAD_DIRECTIONS)}</select></Field>
      <Field label="Next action date"><Input name="next_action_date" type="date" defaultValue={lead.next_action_date_text ?? ""}/></Field>
      <Field label="Funnel stage"><select name="funnel_stage" value={stage} onChange={event => setStage(event.target.value as FunnelStage)} className={controlClass}>{options(FUNNEL_STAGES)}</select></Field>
      {(stage === "Lost" || stage === "Not Qualified") && <Field label="Closure reason"><Select name="closure_reason" required defaultValue={lead.closure_reason}><option value="">Select reason</option>{options(CLOSURE_REASONS)}</Select></Field>}
    </div>
    <Field label="Specific next action" hint="Make the next step concrete enough for anyone to continue."><Textarea key={lead.action_detail ?? ""} name="action_detail" defaultValue={lead.action_detail ?? ""} placeholder="e.g. Send fabric options on Friday"/></Field>
    <Field label="Timeline note"><Textarea name="note" placeholder="What happened in this interaction?"/></Field>
    <Field label="Interaction summary" hint="Update the durable handover summary only when the overall context changes."><Textarea key={lead.interaction_summary ?? ""} name="interaction_summary" defaultValue={lead.interaction_summary ?? ""} placeholder="Current customer context"/></Field>
    <details className="rounded-lg border border-slate-200 bg-slate-50/60"><summary className="cursor-pointer px-4 py-3 text-sm font-medium text-slate-700">Add quotation details</summary><div className="grid gap-4 border-t border-slate-200 p-4 sm:grid-cols-2"><Field label="Quote value (SGD)"><Input name="latest_quote_sgd" type="number" step="0.01" placeholder="0.00"/></Field><Field label="Quotation sent date"><Input name="quotation_sent_date" type="date"/></Field><Field label="Valid for (days)"><Input name="quote_valid_days" type="number" defaultValue={lead.quote_valid_days}/></Field><Field label="Breakdown"><Input name="quotation_breakdown" placeholder="Curtains, blinds, mesh…"/></Field></div></details>
    <div className="flex justify-end"><Button className="h-10 w-full px-5 sm:w-auto" type="submit" disabled={state.pending}>{state.pending ? "Logging…" : "Save update"}</Button></div>
  </form>;
}

export function DetailsForm({ lead, consultants }: { lead: any; consultants: { id: string; full_name: string | null }[] }) {
  const state = useSubmit(editLeadDetails);
  const [pending, start] = useTransition();
  return <form onSubmit={event => { event.preventDefault(); state.submit(event.currentTarget); }} className="space-y-6">
    <input type="hidden" name="id" value={lead.id}/><input type="hidden" name="expected_updated_at" value={new Date(lead.updated_at).toISOString()}/>
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Customer name"><Input name="name" defaultValue={lead.name}/></Field>
      <Field label="Mobile"><Input name="mobile" inputMode="tel" defaultValue={lead.mobile ?? ""}/></Field>
      <Field label="Development"><Input name="development" defaultValue={lead.development ?? ""}/></Field>
      <Field label="Contact channel"><Select name="contact_channel" defaultValue={lead.contact_channel}>{options(CONTACT_CHANNELS)}</Select></Field>
      <Field label="Lead source"><Select name="source" defaultValue={lead.source}><option value="">Unknown source</option>{options(LEAD_SOURCES)}</Select></Field>
      <Field label="Direction"><Select name="inbound_outbound" defaultValue={lead.inbound_outbound}><option value="">Unknown direction</option>{options(LEAD_DIRECTIONS)}</Select></Field>
      <Field label="Primary product"><Select name="primary_product" defaultValue={lead.primary_product}><option value="">Unknown product</option>{lead.primary_product === "Both" && <option value="Both">Both (legacy — choose one to change)</option>}{options(SELECTABLE_PRIMARY_PRODUCTS)}</Select></Field>
      <Field label="Owner" hint="Required so this lead always appears in someone's work queue."><Select name="owner_id" required defaultValue={lead.assigned_consultant_id ?? lead.owner_id ?? ""}><option value="">Select owner</option>{consultants.map(consultant => <option key={consultant.id} value={consultant.id}>{consultant.full_name ?? "Unnamed"}</option>)}</Select></Field>
      <Field label="Move-in date"><Input name="move_in_date" type="date" defaultValue={lead.move_in_date_text ?? ""}/></Field>
      <Field label="Keys"><Select name="keys_collected" defaultValue={lead.keys_collected === null ? "" : String(lead.keys_collected)}><option value="">Unknown</option><option value="true">Collected</option><option value="false">Not collected</option></Select></Field>
      <Field label="Closure reason" className="sm:col-span-2"><Select name="closure_reason" defaultValue={lead.closure_reason}><option value="">No closure reason</option>{options(CLOSURE_REASONS)}</Select></Field>
    </div>
    <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-5 sm:flex-row sm:justify-between"><Button className="h-10" type="button" variant="outline" disabled={pending || lead.is_archived} onClick={() => start(async () => { await archiveLead({ lead_id: lead.id }); toast.success("Lead archived"); })}>Archive lead</Button><Button className="h-10 px-5" type="submit" disabled={state.pending}>{state.pending ? "Saving…" : "Save details"}</Button></div>
  </form>;
}

export function RecommendationBanner({ leadId, recommendation }: { leadId: string; recommendation: Recommendation }) {
  const [pending, start] = useTransition(); const [reason, setReason] = useState("");
  const run = (accept: boolean) => start(async () => { try { await (accept ? acceptRecommendation : dismissRecommendation)({ lead_id: leadId, code: recommendation.code, ...(reason ? { closure_reason: reason } : {}) }); toast.success(accept ? "Recommendation applied" : "Dismissed"); } catch (error) { toast.error(error instanceof Error ? error.message : "Failed"); } });
  return <div className="flex flex-col gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between"><span className="text-sm font-medium text-amber-950">{recommendation.message}</span><div className="flex flex-wrap gap-2">{recommendation.suggestedStage === "Lost" && <select aria-label="Closure reason" value={reason} onChange={event => setReason(event.target.value)} className="h-9 rounded-lg border border-amber-300 bg-white px-2 text-sm"><option value="">Closure reason</option>{options(CLOSURE_REASONS)}</select>}{recommendation.suggestedStage && <Button className="h-9" disabled={pending || (recommendation.suggestedStage === "Lost" && !reason)} onClick={() => run(true)}>Accept</Button>}<Button className="h-9" variant="outline" disabled={pending} onClick={() => run(false)}>Dismiss</Button></div></div>;
}
