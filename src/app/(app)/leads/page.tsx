import Link from "next/link";
import { sql } from "kysely";

import { LeadTable, type LeadRow } from "@/components/leads/lead-table";
import { Input } from "@/components/ui/input";
import { requireRole } from "@/lib/auth/require-role";
import { db } from "@/lib/db/kysely";
import { compareQueueRows, deriveLead } from "@/lib/leads/queue-engine";
import { todayInSingapore, toSgDate } from "@/lib/leads/sg-date";
import { formatSGD } from "@/lib/money";

export const dynamic = "force-dynamic";

export const metadata = { title: "Leads — Drapeworks CRM" };

type SearchParams = { tab?: string; q?: string };

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireRole(["consultant", "admin"]);
  const { tab: tabRaw, q: qRaw } = await searchParams;
  const tab = tabRaw === "all" ? "all" : "queue";
  const q = (qRaw ?? "").trim();
  const today = todayInSingapore();

  let query = db
    .selectFrom("leads")
    .select([
      "id",
      "lead_ref",
      "name",
      "mobile",
      "development",
      "funnel_stage",
      "lead_status",
      "last_outcome",
      "action_detail_override",
      "last_customer_response_at",
      "latest_quote_cents",
      // action_date is a `date` column, and node-pg hands those back as JS Date
      // objects at LOCAL midnight. Reading the calendar date off one of those
      // is a timezone bug waiting for the first deploy outside Singapore, and
      // `String(date).slice(0, 10)` yields "Fri Aug 14" — which then sorts and
      // compares as a string against "2026-08-22" and silently ruins every
      // due-status and priority band. Casting in Postgres is exact.
      sql<string | null>`leads.action_date::text`.as("action_date"),
    ])
    .where("is_archived", "=", false);

  if (q.length >= 2) {
    const like = `%${q.replace(/[%_]/g, "")}%`;
    query = query.where((eb) =>
      eb.or([
        eb("name", "ilike", like),
        eb("mobile", "ilike", like),
        eb("development", "ilike", like),
        eb("lead_ref", "ilike", like),
      ]),
    );
  }

  const leads = await query.execute();

  // Derived at read time: every rule depends on today's date, so a stored copy
  // would be stale the moment the clock rolls over.
  const rows: LeadRow[] = leads.map((lead) => ({
    id: lead.id,
    lead_ref: lead.lead_ref,
    name: lead.name,
    mobile: lead.mobile,
    development: lead.development,
    latest_quote_cents: lead.latest_quote_cents,
    derived: deriveLead(
      {
        funnel_stage: lead.funnel_stage,
        lead_status: lead.lead_status,
        last_outcome: lead.last_outcome,
        action_detail_override: lead.action_detail_override,
        action_date: lead.action_date,
        last_customer_response_at: lead.last_customer_response_at
          ? toSgDate(new Date(lead.last_customer_response_at))
          : null,
      },
      today,
    ),
  }));

  const inQueue = rows.filter((r) => r.derived.queueVisibility === "Include");
  const visible = [...(tab === "all" ? rows : inQueue)].sort(compareQueueRows);

  const queueCount = inQueue.length;
  const todayCount = inQueue.filter((r) => r.derived.priorityRank === 1).length;

  // The one aggregate Alan reads every morning. This figure will NOT match the
  // spreadsheet, and that is the intended behaviour: the sheet's formula is
  // =SUM(K8:K39), a 32-row range over a 40-row queue that was sized when the
  // queue was shorter and never grown. It shows 16,476 where the true total is
  // 20,106 — a 3,630 undercount. The fourth spreadsheet bug, and the only one
  // fixed rather than carried, because unlike the other three nothing depends
  // on reproducing it. See the spec's "bugs carried knowingly" section.
  const pipelineCents = inQueue.reduce(
    (sum, r) => sum + (r.latest_quote_cents ?? 0),
    0,
  );

  const tabs = [
    { key: "queue", label: `Daily Queue (${queueCount})` },
    { key: "all", label: `All Leads (${rows.length})` },
  ];

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">Leads</h1>
          <p className="text-sm text-slate-500 mt-1">
            {queueCount} in the queue · {todayCount} to contact today ·{" "}
            {formatSGD(pipelineCents)} pipeline
          </p>
        </div>
        <Link
          href="/leads/new"
          className="inline-flex items-center justify-center gap-2 bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded font-medium text-sm"
        >
          <span>+</span> New Lead
        </Link>
      </div>

      <nav className="flex gap-1 border-b border-slate-200 mb-4">
        {tabs.map((t) => (
          <Link
            key={t.key}
            // The search survives a tab switch — losing it on every click is
            // how you end up searching twice for the same person.
            href={q ? `/leads?tab=${t.key}&q=${encodeURIComponent(q)}` : `/leads?tab=${t.key}`}
            className={
              tab === t.key
                ? "px-4 py-2 text-sm border-b-2 border-teal-600 font-medium text-teal-700"
                : "px-4 py-2 text-sm text-slate-500 hover:text-slate-700"
            }
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {/* A plain GET form, so the list stays a server component with no client
          JavaScript at all. */}
      <form
        action="/leads"
        className="bg-white rounded-lg border border-slate-200 mb-4 p-3"
      >
        <input type="hidden" name="tab" value={tab} />
        <label htmlFor="q" className="sr-only">
          Search leads
        </label>
        <Input
          id="q"
          name="q"
          type="search"
          defaultValue={q}
          placeholder="Search name, mobile, development or lead ref"
          className="h-9 border-slate-200 sm:max-w-sm"
        />
      </form>

      <LeadTable rows={visible} />
    </main>
  );
}
