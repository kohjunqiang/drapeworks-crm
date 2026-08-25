import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "kysely";

import { AppointmentCard } from "@/components/leads/appointment-card";
import { BookAppointmentDialog } from "@/components/leads/book-appointment-dialog";
import { LeadFieldsForm } from "@/components/leads/lead-fields-form";
import { Badge } from "@/components/ui/badge";
import { requireRole } from "@/lib/auth/require-role";
import { isCalendarConfigured } from "@/lib/calendar/google";
import { db } from "@/lib/db/kysely";
import { deriveLead } from "@/lib/leads/queue-engine";
import { todayInSingapore, toSgDate } from "@/lib/leads/sg-date";

export const dynamic = "force-dynamic";

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ leadId: string }>;
}) {
  await requireRole(["consultant", "admin"]);
  const { leadId } = await params;

  // A malformed id would otherwise reach Postgres as an invalid uuid literal
  // and throw a 500 where a 404 is the honest answer.
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      leadId,
    )
  ) {
    notFound();
  }

  const lead = await db
    .selectFrom("leads")
    .selectAll()
    // Same reason as the list page: node-pg turns a `date` column into a JS
    // Date at local midnight, and reading the calendar date back off one of
    // those is a timezone bug. Postgres does the formatting.
    .select(sql<string | null>`leads.action_date::text`.as("action_date_text"))
    .where("id", "=", leadId)
    .executeTakeFirst();
  if (!lead) notFound();

  const appointment = await db
    .selectFrom("appointments")
    .selectAll()
    .where("lead_id", "=", leadId)
    .where("status", "!=", "cancelled")
    .orderBy("scheduled_at", "desc")
    .executeTakeFirst();

  const actionDate = lead.action_date_text;
  const derived = deriveLead(
    {
      funnel_stage: lead.funnel_stage,
      lead_status: lead.lead_status,
      last_outcome: lead.last_outcome,
      action_detail_override: lead.action_detail_override,
      action_date: actionDate,
      last_customer_response_at: lead.last_customer_response_at
        ? toSgDate(new Date(lead.last_customer_response_at))
        : null,
    },
    todayInSingapore(),
  );

  const facts: [string, string][] = [
    ["Action required", derived.actionRequired],
    ["Next action", derived.nextAction || "—"],
    ["Due", derived.effectiveActionDate ?? derived.dueStatus],
    ["Priority", derived.contactPriority],
  ];

  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <Link
        href="/leads"
        className="text-sm text-slate-500 hover:text-slate-700"
      >
        ← Back to leads
      </Link>

      <header className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mt-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
            {lead.name}
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            {lead.lead_ref} · {lead.development ?? "No development"}
            {lead.mobile ? ` · ${lead.mobile}` : ""}
          </p>
        </div>
        {/* Booking is offered only where the engine says it is the next step,
            and only while there is no live appointment to attend. Keyed on
            'scheduled' rather than on the row existing: a no-show is not
            cancelled, so it stays visible as history, and its lead is restored
            to its pre-booking stage — which for most of them derives
            'Book Appointment' again. Testing `!appointment` would leave those
            leads with the one action they need and no way to take it. */}
        {derived.actionRequired === "Book Appointment" &&
        appointment?.status !== "scheduled" ? (
          <BookAppointmentDialog
            leadId={lead.id}
            leadName={lead.name}
            leadMobile={lead.mobile}
            development={lead.development}
          />
        ) : null}
      </header>

      {/* Read-only: these come from the engine, not from anyone typing them. */}
      <section className="mt-6 rounded-lg border border-slate-200 bg-slate-50 p-4 sm:p-6">
        <h2 className="text-xs font-medium uppercase tracking-wide text-slate-500">
          Derived by the funnel engine
        </h2>
        <dl className="mt-3 grid grid-cols-1 sm:grid-cols-4 gap-3 sm:gap-4 text-sm">
          {facts.map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-slate-500">{label}</dt>
              <dd className="mt-0.5 text-slate-800">{value}</dd>
            </div>
          ))}
        </dl>
        {derived.queueVisibility !== "Include" ? (
          <Badge className="mt-3 bg-slate-200 text-slate-600">
            Not in the daily queue · {derived.queueVisibility}
          </Badge>
        ) : null}
      </section>

      {appointment ? (
        <div className="mt-6">
          <AppointmentCard
            appointment={appointment}
            calendarConfigured={isCalendarConfigured()}
          />
        </div>
      ) : null}

      <section className="mt-6 bg-white rounded-lg border border-slate-200 p-4 sm:p-6">
        {/* Remount the form whenever the row changes underneath it.
            LeadFieldsForm holds the three selects in useState and the rest in
            uncontrolled defaultValue, both of which are read once on mount.
            The appointment buttons above it mutate the SAME lead — booking
            writes 'Appointment Booked' to stage, outcome and action_date;
            cancelling restores them — and then call router.refresh(). That
            refreshes the server component, so the derived panel updates, but
            React keeps the client form instance and its now-stale initial
            state. The form would sit there showing the pre-booking values, and
            the next "Save lead" — for an unrelated edit — would write them back
            over the booking, silently undoing it while the appointment row
            still says 'scheduled'.
            Keying on updated_at (bumped by every write path) forces a fresh
            mount with the current values. */}
        <LeadFieldsForm
          key={String(lead.updated_at)}
          lead={{
            id: lead.id,
            name: lead.name,
            mobile: lead.mobile,
            development: lead.development,
            funnel_stage: lead.funnel_stage,
            lead_status: lead.lead_status,
            last_outcome: lead.last_outcome,
            action_date: actionDate,
            action_detail_override: lead.action_detail_override,
            interaction_summary: lead.interaction_summary,
            latest_quote_cents: lead.latest_quote_cents,
            latest_quote_note: lead.latest_quote_note,
            buying_readiness: lead.buying_readiness,
            keys_status: lead.keys_status,
            expected_key_date: lead.expected_key_date,
          }}
        />
      </section>

      {lead.historical_summary ? (
        <section className="mt-6 bg-white rounded-lg border border-slate-200 p-4 sm:p-6">
          <h2 className="text-xs font-medium uppercase tracking-wide text-slate-500">
            History
          </h2>
          <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">
            {lead.historical_summary}
          </p>
        </section>
      ) : null}
    </main>
  );
}
