"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { QuickEditLead } from "@/components/leads/phase16-forms";
import { quickEditLead } from "@/lib/actions/leads";
import { CLOSURE_REASONS, CONTACT_CHANNELS, FUNNEL_STAGES, LEAD_SOURCES, type FunnelStage } from "@/lib/leads/funnel-types";

type LeadRow = {
  id: string; lead_ref: string; name: string; funnel_stage: FunnelStage; lead_status: string;
  last_outcome: string | null; mobile?: string | null; development?: string | null;
  contact_channel: string; source?: string | null; primary_product?: string | null;
  next_action_date_text: string | null; move_in_date_text?: string | null;
  action_detail: string | null; latest_quote_cents?: number | null;
  closure_reason?: string | null; assigned_consultant_id: string | null; owner_id: string | null;
};

const inputClass = "h-9 w-full min-w-24 rounded-md border border-slate-300 bg-white px-2 text-xs outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100";

export function EditableLeadRow({ lead, consultants, variant, ownerName, actionLabel, moveInDisplay, lastContactText }: {
  lead: LeadRow; consultants: { id: string; full_name: string | null }[]; variant: "work" | "all";
  ownerName: string; actionLabel?: string; moveInDisplay?: string; lastContactText?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(lead.name);
  const [ownerId, setOwnerId] = useState(lead.assigned_consultant_id ?? lead.owner_id ?? "");
  const [stage, setStage] = useState(lead.funnel_stage);
  const [closureReason, setClosureReason] = useState(lead.closure_reason ?? "");
  const [nextDate, setNextDate] = useState(lead.next_action_date_text ?? "");
  const [moveInDate, setMoveInDate] = useState(lead.move_in_date_text ?? "");
  const [detail, setDetail] = useState(lead.action_detail ?? "");
  const [quote, setQuote] = useState(lead.latest_quote_cents ? String(lead.latest_quote_cents / 100) : "");
  const [channel, setChannel] = useState(lead.contact_channel);
  const [source, setSource] = useState(lead.source ?? "");

  const save = () => startTransition(async () => {
    try {
      await quickEditLead({ id: lead.id, name, owner_id: ownerId, funnel_stage: stage,
        closure_reason: closureReason, next_action_date: nextDate, move_in_date: moveInDate,
        action_detail: detail, latest_quote_sgd: quote, mobile: lead.mobile ?? "",
        development: lead.development ?? "", contact_channel: channel, source,
        primary_product: lead.primary_product ?? "" });
      toast.success("Lead updated"); setEditing(false); router.refresh();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Save failed"); }
  });

  const actions = <button type="button" onClick={() => setEditing(true)} className="h-8 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50">Edit</button>;
  if (!editing) return variant === "work" ? <tr className="border-b last:border-b-0 hover:bg-slate-50/70"><td className="p-3"><QuickEditLead lead={lead} consultants={consultants} trigger="name"/><div className="text-xs text-slate-500">{lead.lead_ref}</div></td><td className="p-3 font-medium">{actionLabel}</td><td className="p-3">{lead.funnel_stage}</td><td className="max-w-64 p-3 text-slate-600">{lead.action_detail ?? "—"}</td><td className="p-3">{lead.next_action_date_text ?? "—"}</td><td className="p-3">{moveInDisplay ?? "—"}</td><td className="p-3">{lead.latest_quote_cents ? `$${(lead.latest_quote_cents / 100).toLocaleString("en-SG", { minimumFractionDigits: 2 })}` : "—"}</td><td className="p-3">{lastContactText ?? "—"}</td><td className="p-3">{ownerName}</td><td className="p-3">{actions}</td></tr>
    : <tr className="border-b last:border-b-0 hover:bg-slate-50/70"><td className="p-3"><QuickEditLead lead={lead} consultants={consultants} trigger="name"/><div className="text-xs text-slate-500">{lead.lead_ref}</div></td><td className="p-3">{lead.funnel_stage}</td><td className="p-3">{lead.lead_status}</td><td className="p-3">{lead.last_outcome ?? "—"}</td><td className="p-3">{ownerName}</td><td className="p-3">{lead.contact_channel}</td><td className="p-3">{lead.source ?? "—"}</td><td className="p-3">{lead.next_action_date_text ?? "—"}</td><td className="p-3">{lead.latest_quote_cents ? `$${(lead.latest_quote_cents / 100).toFixed(2)}` : "—"}</td><td className="p-3">{actions}</td></tr>;

  const customer = <input aria-label="Customer" value={name} onChange={event => setName(event.target.value)} className={inputClass}/>;
  const stageControl = <div className="flex items-center gap-1"><select aria-label="Stage" value={stage} onChange={event => setStage(event.target.value as FunnelStage)} className={inputClass}>{FUNNEL_STAGES.map(value => <option key={value}>{value}</option>)}</select>{(stage === "Lost" || stage === "Not Qualified") && <select aria-label="Closure reason" value={closureReason} onChange={event => setClosureReason(event.target.value)} className={inputClass}><option value="">Reason</option>{CLOSURE_REASONS.map(value => <option key={value}>{value}</option>)}</select>}</div>;
  const owner = <select aria-label="Owner" required value={ownerId} onChange={event => setOwnerId(event.target.value)} className={inputClass}><option value="">Select</option>{consultants.map(person => <option key={person.id} value={person.id}>{person.full_name ?? "Unnamed"}</option>)}</select>;
  const editActions = <div className="flex flex-nowrap justify-end gap-1"><button type="button" disabled={pending || !ownerId || !name || ((stage === "Lost" || stage === "Not Qualified") && !closureReason)} onClick={save} className="h-8 rounded-lg bg-teal-600 px-3 text-xs font-medium text-white disabled:opacity-50">{pending ? "Saving…" : "Save"}</button><button type="button" onClick={() => setEditing(false)} className="h-8 rounded-lg border border-slate-200 px-3 text-xs font-medium">Cancel</button><QuickEditLead lead={lead} consultants={consultants} trigger="advanced"/></div>;
  if (variant === "work") return <tr className="border-b bg-teal-50/40 align-middle whitespace-nowrap"><td className="p-2">{customer}</td><td className="p-2 text-xs text-slate-500">Auto-calculated</td><td className="p-2">{stageControl}</td><td className="p-2"><input aria-label="Detail" value={detail} onChange={event => setDetail(event.target.value)} className={inputClass}/></td><td className="p-2"><input aria-label="Next date" type="date" value={nextDate} onChange={event => setNextDate(event.target.value)} className={inputClass}/></td><td className="p-2"><input aria-label="Move-in date" type="date" value={moveInDate} onChange={event => setMoveInDate(event.target.value)} className={inputClass}/></td><td className="p-2"><input aria-label="Quote" type="number" min="0" step="0.01" value={quote} onChange={event => setQuote(event.target.value)} className={inputClass}/></td><td className="p-2 text-xs text-slate-500">From timeline</td><td className="p-2">{owner}</td><td className="p-2">{editActions}</td></tr>;
  return <tr className="border-b bg-teal-50/40 align-middle whitespace-nowrap"><td className="p-2">{customer}</td><td className="p-2">{stageControl}</td><td className="p-2 text-xs text-slate-500">Auto</td><td className="p-2 text-xs text-slate-500">From timeline</td><td className="p-2">{owner}</td><td className="p-2"><select aria-label="Channel" value={channel} onChange={event => setChannel(event.target.value)} className={inputClass}>{CONTACT_CHANNELS.map(value => <option key={value}>{value}</option>)}</select></td><td className="p-2"><select aria-label="Source" value={source} onChange={event => setSource(event.target.value)} className={inputClass}><option value="">Unknown</option>{LEAD_SOURCES.map(value => <option key={value}>{value}</option>)}</select></td><td className="p-2"><input aria-label="Next date" type="date" value={nextDate} onChange={event => setNextDate(event.target.value)} className={inputClass}/></td><td className="p-2"><input aria-label="Quote" type="number" min="0" step="0.01" value={quote} onChange={event => setQuote(event.target.value)} className={inputClass}/></td><td className="p-2">{editActions}</td></tr>;
}
