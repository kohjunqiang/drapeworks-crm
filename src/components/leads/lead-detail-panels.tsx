"use client";

import { useState, type ReactNode } from "react";

import { BookAppointmentDialog } from "@/components/leads/book-appointment-dialog";
import { LogUpdateForm } from "@/components/leads/phase16-forms";
import { bookingBlockedReason } from "@/lib/leads/booking";
import type { FunnelStage } from "@/lib/leads/funnel-types";

// Booking a lead bumps its updated_at, and the refresh that follows would
// remount the keyed LogUpdateForm and drop a half-written update. Keeping the
// form's dirty state here lets the booking trigger warn before that happens —
// the same discard-confirmation convention MarkAsWonDialog already uses.
export function LeadDetailPanels({
  lead,
  consultants,
  appointmentCard,
  hasScheduledAppointment,
}: {
  lead: {
    id: string;
    name: string;
    mobile: string | null;
    development: string | null;
    funnel_stage: FunnelStage;
    is_archived: boolean;
    updated_at: Date | string;
    next_action_date_text?: string | null;
    closure_reason?: string | null;
    interaction_summary: string | null;
    action_detail: string | null;
    quote_valid_days: number;
  };
  consultants: { id: string; full_name: string | null }[];
  appointmentCard: ReactNode;
  hasScheduledAppointment: boolean;
}) {
  const [logDirty, setLogDirty] = useState(false);
  const blocked = bookingBlockedReason(lead);
  return <>
    <section className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6"><div className="mb-4"><h2 className="font-semibold">Log update</h2><p className="mt-1 text-sm text-slate-500">Record what happened and set the next clear action.</p></div><LogUpdateForm key={new Date(lead.updated_at).toISOString()} lead={lead} onDirty={() => setLogDirty(true)} onSuccess={() => setLogDirty(false)} onWon={() => setLogDirty(false)}/></section>
    <section className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6"><h2 className="mb-4 font-semibold">Appointment</h2>{appointmentCard}{hasScheduledAppointment ? null : blocked ? <p className={`text-sm text-slate-500${appointmentCard ? " mt-3" : ""}`}>{blocked}</p> : <div className={appointmentCard ? "mt-3" : ""}><BookAppointmentDialog leadId={lead.id} leadName={lead.name} leadMobile={lead.mobile} development={lead.development} consultants={consultants} onBooked={() => setLogDirty(false)} beforeOpen={() => !logDirty || window.confirm("Booking this appointment will discard the unsaved update. Continue?")}/></div>}</section>
  </>;
}
