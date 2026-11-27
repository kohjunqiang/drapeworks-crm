"use client";

import Link from "next/link";
import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { PriorityBadge } from "@/components/leads/priority";
import { QuickEditLead } from "@/components/leads/phase16-forms";
import { FunnelStagePill } from "@/components/leads/funnel-stage-pill";
import { archiveLead } from "@/lib/actions/leads";
import type { FunnelStage } from "@/lib/leads/funnel-types";
import { useBatchEdit, batchRowDomId } from "@/components/leads/batch-edit-context";
import { BatchExpandedFields, BatchField, LeadSelectCheckbox } from "@/components/leads/batch-edit-fields";

type LeadRow = import("@/lib/leads/priority").PriorityInput & import("@/lib/leads/priority").StoredPriority & {
  inbound_outbound?: string | null; created_date_text?: string; initiated_date_text?: string | null; last_contact_date_text?: string | null;
  id: string; lead_ref: string; name: string; funnel_stage: FunnelStage; lead_status: string;
  last_outcome: string | null; mobile?: string | null; development?: string | null;
  contact_channel: string; source?: string | null; primary_product?: string | null;
  next_action_date_text: string | null; move_in_date_text?: string | null;
  action_detail: string | null; latest_quote_cents?: number | null;
  closure_reason?: string | null; assigned_consultant_id: string | null; owner_id: string | null;
};

export function EditableLeadRow({ lead, consultants, variant, ownerName, actionLabel, moveInDisplay, lastContactText, dueLabel }: {
  lead: LeadRow; consultants: { id: string; full_name: string | null }[]; variant: "work" | "all";
  ownerName: string; actionLabel?: string; moveInDisplay?: string; lastContactText?: string; dueLabel?: string;
}) {
  const batch = useBatchEdit();
  const entry = batch?.entries[lead.id];
  const selected = !!entry && !entry.loading;
  // Keep the stored page fresh so jump-back lands on the right page.
  useEffect(() => { if (selected) batch?.noteSeen(lead.id); });
  const priority = <td className="px-2 py-2"><Link href={`/leads/${lead.id}#lead-priority`} aria-label={`View priority breakdown for ${lead.name}`} className="inline-flex rounded hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600"><PriorityBadge lead={lead} compact/></Link></td>;
  // Single-row edit/archive compete with an in-flight batch save — disable them.
  const actions = <div inert={batch?.saving || undefined} className={`flex items-center justify-end gap-1.5 ${batch?.saving ? "opacity-50" : ""}`}><QuickEditLead lead={lead} consultants={consultants} trigger="edit"/><ArchiveLeadButton leadId={lead.id} leadName={lead.name}/></div>;
  if (variant === "work") return <tr className="border-b last:border-b-0 hover:bg-slate-50/70"><td className="px-2 py-3"><span inert={batch?.saving || undefined} className={batch?.saving ? "opacity-50" : ""}><QuickEditLead lead={lead} consultants={consultants} trigger="name"/></span><div className="text-xs text-slate-500">{lead.lead_ref}</div></td><td className="px-2 py-3 font-medium">{actionLabel}</td><td className="px-2 py-3"><FunnelStagePill stage={lead.funnel_stage}/></td><td className="max-w-64 p-3 text-slate-600">{lead.action_detail ?? "—"}</td><td className="px-2 py-3">{lead.next_action_date_text ?? "—"}</td>{priority}<td className="px-2 py-3">{moveInDisplay ?? "—"}</td><td className="px-2 py-3">{lead.latest_quote_cents ? `$${(lead.latest_quote_cents / 100).toLocaleString("en-SG", { minimumFractionDigits: 2 })}` : "—"}</td><td className="px-2 py-3">{lastContactText ?? "—"}</td><td className="px-2 py-3">{ownerName}</td><td className="px-2 py-3">{actions}</td></tr>;
  const selectCell = <td className="px-1 py-2 align-middle">{batch && <LeadSelectCheckbox lead={{ id: lead.id, name: lead.name }}/>}</td>;
  if (selected && batch) {
    const expanded = entry.expanded;
    const showPanel = expanded || !!entry.errors.__lead || !!entry.conflict;
    return <>
      <tr id={batchRowDomId(lead.id, "table")} tabIndex={-1} className="border-b last:border-b-0 bg-teal-50/40">
        {selectCell}
        <td className="px-2 py-2"><BatchField leadId={lead.id} field="name" variant="table" compact/><div className="mt-1 text-xs text-slate-500">{lead.lead_ref}</div></td>
        <td className="px-2 py-2"><BatchField leadId={lead.id} field="inbound_outbound" variant="table" compact/></td>
        <td className="truncate px-2 py-2" title={lead.initiated_date_text ?? undefined}>{lead.initiated_date_text ?? "—"}</td>
        <td className="truncate px-2 py-2" title={lead.last_contact_date_text ?? undefined}>{lead.last_contact_date_text ?? "—"}</td>
        <td className="px-2 py-2"><BatchField leadId={lead.id} field="funnel_stage" variant="table" compact/></td>
        <td className="truncate px-2 py-2" title={lead.lead_status}>{lead.lead_status}</td>
        <td className="px-2 py-2"><BatchField leadId={lead.id} field="last_outcome" variant="table" compact/></td>
        <td className="truncate px-2 py-2" title={actionLabel ?? undefined}>{actionLabel ?? "—"}</td>
        <td className="px-2 py-2"><BatchField leadId={lead.id} field="action_detail" variant="table" compact/></td>
        <td className="px-2 py-2"><BatchField leadId={lead.id} field="next_action_date" variant="table" compact/></td>
        {priority}
        <td className="truncate px-2 py-2" title={dueLabel ?? undefined}>{dueLabel ?? "—"}</td>
        <td className="px-2 py-2 text-right"><div className="flex items-center justify-end gap-1.5">
          <button type="button" aria-expanded={showPanel} aria-controls={`batch-more-table-${lead.id}`} disabled={batch.saving} onClick={() => batch.setExpanded(lead.id, !expanded)}
            className="inline-flex h-11 items-center rounded-lg border border-teal-200 bg-white px-2.5 text-xs font-medium text-teal-700 hover:bg-teal-50 disabled:opacity-50">
            {expanded ? "Less" : "More"}
          </button>
          {actions}
        </div></td>
      </tr>
      {showPanel && <tr id={`batch-more-table-${lead.id}`} className="border-b last:border-b-0 bg-teal-50/20">
        <td colSpan={14} className="px-3 py-4"><BatchExpandedFields leadId={lead.id} variant="table" consultants={consultants}/></td>
      </tr>}
    </>;
  }
  return <tr id={batch ? batchRowDomId(lead.id, "table") : undefined} tabIndex={batch ? -1 : undefined} className="border-b last:border-b-0 hover:bg-slate-50/70">
    {selectCell}
    <td className="px-2 py-2"><span inert={batch?.saving || undefined} className={batch?.saving ? "opacity-50" : ""}><QuickEditLead lead={lead} consultants={consultants} trigger="name"/></span></td>
    {[lead.inbound_outbound, lead.initiated_date_text, lead.last_contact_date_text].map((value, index) => <td key={index} className="truncate px-2 py-2" title={value ?? undefined}>{value ?? "—"}</td>)}
    <td className="px-2 py-2"><FunnelStagePill stage={lead.funnel_stage}/></td>
    <td className="truncate px-2 py-2" title={lead.lead_status}>{lead.lead_status}</td>
    <td className="px-2 py-2 leading-4" title={lead.last_outcome ?? undefined}>{lead.last_outcome ?? "—"}</td>
    {[actionLabel, lead.action_detail, lead.next_action_date_text].map((value, index) => <td key={index} className="truncate px-2 py-2" title={value ?? undefined}>{value ?? "—"}</td>)}
    {priority}
    <td className="truncate px-2 py-2" title={dueLabel ?? undefined}>{dueLabel ?? "—"}</td>
    <td className="px-2 py-2 text-right">{actions}</td>
  </tr>;
}

export function ArchiveLeadButton({ leadId, leadName, fullWidth = false }: { leadId: string; leadName: string; fullWidth?: boolean }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const remove = () => {
    if (!window.confirm(`Archive ${leadName}? The lead will be removed from the workspace and analytics.`)) return;
    startTransition(async () => {
      try {
        await archiveLead({ lead_id: leadId });
        toast.success(`${leadName} archived`);
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not archive lead");
      }
    });
  };
  return <button type="button" disabled={pending} onClick={remove} className={`inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 ${fullWidth ? "h-11 w-full text-sm" : "h-8 px-2.5 text-xs"}`}>{pending ? "Archiving…" : "Archive"}</button>;
}
