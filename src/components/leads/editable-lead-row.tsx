"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { QuickEditLead } from "@/components/leads/phase16-forms";
import { FunnelStagePill } from "@/components/leads/funnel-stage-pill";
import { deleteLead } from "@/lib/actions/leads";
import type { FunnelStage } from "@/lib/leads/funnel-types";

type LeadRow = {
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
  const actions = <div className="flex items-center justify-end gap-1.5"><QuickEditLead lead={lead} consultants={consultants} trigger="edit"/><DeleteLeadButton leadId={lead.id} leadName={lead.name}/></div>;
  return variant === "work" ? <tr className="border-b last:border-b-0 hover:bg-slate-50/70"><td className="px-2 py-3"><QuickEditLead lead={lead} consultants={consultants} trigger="name"/><div className="text-xs text-slate-500">{lead.lead_ref}</div></td><td className="px-2 py-3 font-medium">{actionLabel}</td><td className="px-2 py-3"><FunnelStagePill stage={lead.funnel_stage}/></td><td className="max-w-64 p-3 text-slate-600">{lead.action_detail ?? "—"}</td><td className="px-2 py-3">{lead.next_action_date_text ?? "—"}</td><td className="px-2 py-3">{moveInDisplay ?? "—"}</td><td className="px-2 py-3">{lead.latest_quote_cents ? `$${(lead.latest_quote_cents / 100).toLocaleString("en-SG", { minimumFractionDigits: 2 })}` : "—"}</td><td className="px-2 py-3">{lastContactText ?? "—"}</td><td className="px-2 py-3">{ownerName}</td><td className="px-2 py-3">{actions}</td></tr>
    : <tr className="border-b last:border-b-0 hover:bg-slate-50/70">
      <td className="px-2 py-2"><QuickEditLead lead={lead} consultants={consultants} trigger="name"/></td>
      {[lead.inbound_outbound, lead.initiated_date_text, lead.last_contact_date_text].map((value, index) => <td key={index} className="truncate px-2 py-2" title={value ?? undefined}>{value ?? "—"}</td>)}
      <td className="px-2 py-2"><FunnelStagePill stage={lead.funnel_stage}/></td>
      <td className="truncate px-2 py-2" title={lead.lead_status}>{lead.lead_status}</td>
      <td className="px-2 py-2 leading-4" title={lead.last_outcome ?? undefined}>{lead.last_outcome ?? "—"}</td>
      {[actionLabel, lead.action_detail, lead.next_action_date_text, dueLabel].map((value, index) => <td key={index} className="truncate px-2 py-2" title={value ?? undefined}>{value ?? "—"}</td>)}
      <td className="px-2 py-2 text-right">{actions}</td>
    </tr>;

}

export function DeleteLeadButton({ leadId, leadName, fullWidth = false }: { leadId: string; leadName: string; fullWidth?: boolean }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const remove = () => {
    if (!window.confirm(`Permanently delete ${leadName}? This cannot be undone.`)) return;
    startTransition(async () => {
      try {
        await deleteLead({ lead_id: leadId });
        toast.success(`${leadName} permanently deleted`);
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not delete lead");
      }
    });
  };
  return <button type="button" disabled={pending} onClick={remove} className={`inline-flex items-center justify-center rounded-lg border border-rose-200 bg-white font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50 ${fullWidth ? "h-10 w-full text-sm" : "h-8 px-2.5 text-xs"}`}>{pending ? "Deleting…" : "Delete"}</button>;
}
