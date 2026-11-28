"use client";

import { useEffect } from "react";

import { PriorityBadge } from "@/components/leads/priority";
import { QuickEditLead } from "@/components/leads/phase16-forms";
import { FunnelStagePill } from "@/components/leads/funnel-stage-pill";
import { FollowUpLabel } from "@/components/leads/follow-up-label";
import { ArchiveLeadButton } from "@/components/leads/editable-lead-row";
import { useBatchEdit, batchRowDomId } from "@/components/leads/batch-edit-context";
import { BatchExpandedFields, BatchField, LeadSelectCheckbox } from "@/components/leads/batch-edit-fields";
import type { FunnelStage } from "@/lib/leads/funnel-types";
import type { PriorityInput, StoredPriority } from "@/lib/leads/priority";

type CardLead = PriorityInput & StoredPriority & {
  id: string; lead_ref: string; name: string; funnel_stage: FunnelStage; lead_status: string;
  inbound_outbound?: string | null; initiated_date_text?: string | null; last_contact_date_text?: string | null;
  last_outcome: string | null; action_detail: string | null; next_action_date_text: string | null;
  mobile?: string | null; development?: string | null; contact_channel?: string;
  source?: string | null; primary_product?: string | null; move_in_date_text?: string | null;
  latest_quote_cents?: number | null; closure_reason?: string | null;
  assigned_consultant_id: string | null; owner_id: string | null;
};

const READONLY_ITEMS = (lead: CardLead, actionLabel: string, dueLabel: string) => [
  ["Initiated Date", lead.initiated_date_text ?? "—"],
  ["Last Contact Date", lead.last_contact_date_text ?? "—"],
  ["Lead Status", lead.lead_status],
  ["Action Required", actionLabel],
  ["Due Status", dueLabel],
] as const;

export function BatchLeadCard({ lead, consultants, actionLabel, dueLabel, followUpLabel }: {
  lead: CardLead; consultants: { id: string; full_name: string | null }[];
  actionLabel: string; dueLabel: string; followUpLabel?: string | null;
}) {
  const batch = useBatchEdit();
  const entry = batch?.entries[lead.id];
  const selected = !!entry && !entry.loading;
  useEffect(() => { if (selected) batch?.noteSeen(lead.id); });

  if (selected && batch) {
    const changed = batch.changedFor(lead.id).length;
    const showPanel = entry.expanded || !!entry.errors.__lead || !!entry.conflict;
    return <article id={batchRowDomId(lead.id, "card")} tabIndex={-1} className="min-w-0 rounded-xl border border-teal-300 bg-white p-4 shadow-sm ring-1 ring-teal-200">
      <div className="flex items-center gap-2">
        <LeadSelectCheckbox lead={{ id: lead.id, name: lead.name }}/>
        <span className="text-xs font-medium text-teal-800">Editing{changed ? ` · ${changed} field${changed === 1 ? "" : "s"} changed` : ""}</span>
      </div>
      <div className="mt-2"><BatchField leadId={lead.id} field="name" variant="card"/></div>
      <div className="mt-1 text-xs text-slate-500">{lead.lead_ref}</div>
      <FollowUpLabel label={followUpLabel}/>
      <PriorityBadge lead={lead} compact/>
      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
        {READONLY_ITEMS(lead, actionLabel, dueLabel).map(([label, value]) => <div key={label} className="min-w-0 break-words">
          <dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1">{value}</dd>
        </div>)}
      </dl>
      <div className="mt-3 grid gap-3">
        <BatchField leadId={lead.id} field="inbound_outbound" variant="card"/>
        <BatchField leadId={lead.id} field="funnel_stage" variant="card"/>
        <BatchField leadId={lead.id} field="last_outcome" variant="card"/>
        <BatchField leadId={lead.id} field="next_action_date" variant="card"/>
        <BatchField leadId={lead.id} field="action_detail" variant="card"/>
      </div>
      <button type="button" aria-expanded={showPanel} aria-controls={`batch-more-card-${lead.id}`} disabled={batch.saving} onClick={() => batch.setExpanded(lead.id, !entry.expanded)}
        className="mt-3 inline-flex h-11 w-full items-center justify-center rounded-lg border border-teal-200 bg-white text-sm font-medium text-teal-700 hover:bg-teal-50 disabled:opacity-50">
        {entry.expanded ? "Fewer fields" : "More fields"}
      </button>
      {showPanel && <div id={`batch-more-card-${lead.id}`} className="mt-3"><BatchExpandedFields leadId={lead.id} variant="card" consultants={consultants}/></div>}
      <div inert={batch.saving || undefined} className={`mt-4 grid grid-cols-3 gap-2 [&_button]:min-h-11 ${batch.saving ? "opacity-50" : ""}`}><QuickEditLead lead={lead} consultants={consultants} trigger="view" fullWidth/><QuickEditLead lead={lead} consultants={consultants} fullWidth/><ArchiveLeadButton leadId={lead.id} leadName={lead.name} fullWidth/></div>
    </article>;
  }

  return <article id={batch ? batchRowDomId(lead.id, "card") : undefined} tabIndex={batch ? -1 : undefined} className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
    <div className="flex items-center gap-1">
      {batch && <LeadSelectCheckbox lead={{ id: lead.id, name: lead.name }}/>}
      <span inert={batch?.saving || undefined} className={batch?.saving ? "opacity-50" : ""}><QuickEditLead lead={lead} consultants={consultants} trigger="name"/></span>
    </div>
    <div className="mt-1 text-xs text-slate-500">{lead.lead_ref}</div><FollowUpLabel label={followUpLabel}/><PriorityBadge lead={lead} compact/>
    <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">{[
      ["Inbound / Outbound", lead.inbound_outbound ?? "—"],
      ["Initiated Date", lead.initiated_date_text ?? "—"],
      ["Last Contact Date", lead.last_contact_date_text ?? "—"],
      ["Funnel Stage", lead.funnel_stage],
      ["Lead Status", lead.lead_status],
      ["Last Contact Outcome", lead.last_outcome ?? "—"],
      ["Action Required", actionLabel],
      ["Action Detail", lead.action_detail ?? "—"],
      ["Next Action Date", lead.next_action_date_text ?? "—"],
      ["Due Status", dueLabel],
    ].map(([label, value]) => <div key={label} className="min-w-0 break-words"><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1">{label === "Funnel Stage" ? <FunnelStagePill stage={lead.funnel_stage}/> : value}</dd></div>)}</dl>
    <div inert={batch?.saving || undefined} className={`mt-4 grid grid-cols-3 gap-2 [&_button]:min-h-11 ${batch?.saving ? "opacity-50" : ""}`}><QuickEditLead lead={lead} consultants={consultants} trigger="view" fullWidth/><QuickEditLead lead={lead} consultants={consultants} fullWidth/><ArchiveLeadButton leadId={lead.id} leadName={lead.name} fullWidth/></div>
  </article>;
}
