import { readPriority, PRIORITY_MEANINGS, type StoredPriority, type PriorityInput } from "@/lib/leads/priority";
const styles = { A: "bg-teal-700 text-white", B: "bg-teal-50 text-teal-800", C: "bg-slate-100 text-slate-700", D: "bg-stone-100 text-stone-600" };
export function PriorityBadge({ lead, compact = false }: { lead: PriorityInput & StoredPriority; compact?: boolean }) {
  const result = readPriority(lead);
  if (compact) return <span title={result.priority_class ? `${result.priority_class} — ${PRIORITY_MEANINGS[result.priority_class].label}${result.priority_score !== null ? ` · ${result.priority_score}/100` : ""}` : `Missing: ${result.missing.join(", ")}`} className={`inline rounded box-decoration-clone px-2 py-0.5 text-xs font-semibold ${result.priority_class ? styles[result.priority_class] : "bg-slate-100 text-slate-500"}`}>{result.priority_class ? `${result.priority_class} — ${PRIORITY_MEANINGS[result.priority_class].label}` : "Pending"}</span>;
  return <span className="mt-1 inline-flex flex-wrap items-center gap-1.5" title={result.priority_class ? `${result.priority_class} — ${PRIORITY_MEANINGS[result.priority_class].label}` : `Missing: ${result.missing.join(", ")}`}><span className={`rounded px-2 py-0.5 text-xs font-semibold ${result.priority_class ? styles[result.priority_class] : "bg-slate-100 text-slate-500"}`}>{result.priority_class ? `Priority ${result.priority_class}` : "Priority: Pending"}</span>{result.priority_score !== null && <span className="text-xs font-normal text-slate-500">{result.priority_score} / 100</span>}</span>;
}
export function PriorityBreakdown({ lead }: { lead: PriorityInput & StoredPriority }) {
  const result = readPriority(lead);
  return <section id="lead-priority" aria-label="Lead priority" className="mb-4 rounded-xl border border-slate-200 bg-white p-4 text-left"><h2 className="text-sm font-semibold">Lead Priority</h2><PriorityBadge lead={lead}/>
    {result.priority_class ? <><h3 className="mt-2 text-sm font-medium">{result.priority_class} — {PRIORITY_MEANINGS[result.priority_class].label}</h3><p className="mt-1 text-sm text-slate-600">{PRIORITY_MEANINGS[result.priority_class].explanation}</p></> : <p className="mt-2 text-sm text-slate-600">Missing: {result.missing.join(", ")}. Complete these fields to calculate priority.</p>}
    {lead.funnel_stage && ["Won", "Lost", "Not Qualified"].includes(lead.funnel_stage) && <p className="mt-2 text-xs text-slate-500">Closed lead: assessment retained for reference; excluded from the Active Queue.</p>}
    <dl className="mt-3 grid gap-3 sm:grid-cols-3">{[
      ["Buying Readiness", result.readiness_score, 8, 40, lead.renovation_buying_stage],
      ["Commercial Value", result.commercial_value_score, 8, 40, lead.latest_quote_cents == null ? null : `S$${(lead.latest_quote_cents / 100).toFixed(2)}`],
      ["Engagement Quality", result.engagement_quality_score, 4, 20, lead.engagement_quality],
    ].map(([label, score, multiplier, max, input]) => <div key={String(label)} className="rounded-lg bg-slate-50 p-3"><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 text-sm">{score === null ? "Pending" : `${score} / 5 · ${Number(score) * Number(multiplier)} / ${max} points`}<span className="mt-1 block text-xs text-slate-500">{input ?? "Not entered"}</span></dd></div>)}</dl>
    <p className="mt-3 text-xs text-slate-500">Readiness × 8 + Commercial Value × 8 + Engagement Quality × 4. Priority determines sales attention; D does not mean Not Qualified.</p>
  </section>;
}
