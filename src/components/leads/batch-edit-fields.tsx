"use client";

import { useBatchEdit, batchFieldDomId, type BatchVariant } from "@/components/leads/batch-edit-context";
import { BATCH_EDITABLE_FIELDS, BATCH_FIELD_LABELS, EXPANDED_FIELDS, TERMINAL_BATCH_STAGES, TEXTAREA_FIELDS, valuesFromSnapshot, type BatchEditableField } from "@/lib/leads/batch-draft";
import {
  CLOSURE_REASONS, CONTACT_CHANNELS, FUNNEL_STAGES, LEAD_DIRECTIONS, LEAD_OUTCOMES,
  LEAD_SOURCES, SELECTABLE_PRIMARY_PRODUCTS,
} from "@/lib/leads/funnel-types";
import { BUYING_STAGES, ENGAGEMENT_QUALITIES } from "@/lib/leads/priority";

const TEXT_FIELDS = new Set<BatchEditableField>(["name", "mobile", "development"]);
const DATE_FIELDS = new Set<BatchEditableField>(["next_action_date", "move_in_date"]);
const TEXTAREA = new Set<BatchEditableField>(TEXTAREA_FIELDS);

const optionList = (values: readonly string[]) => values.map(value => <option key={value} value={value}>{value === "Curtains / Blinds" ? "Curtains & Blinds" : value}</option>);

export function LeadSelectCheckbox({ lead, className = "" }: { lead: { id: string; name: string }; className?: string }) {
  const ctx = useBatchEdit();
  if (!ctx) return null;
  const entry = ctx.entries[lead.id];
  return <label className={`inline-flex h-11 w-11 shrink-0 items-center justify-center ${ctx.saving ? "cursor-not-allowed" : "cursor-pointer"} ${className}`}>
    <input
      type="checkbox"
      className="h-5 w-5 accent-teal-600"
      checked={!!entry}
      disabled={entry?.loading || ctx.saving}
      aria-busy={entry?.loading || undefined}
      onChange={() => ctx.toggle(lead)}
      aria-label={`Select ${lead.name} for batch editing`}
    />
  </label>;
}

export function BatchField({ leadId, field, variant, consultants = [], compact = false, className = "" }: {
  leadId: string;
  field: BatchEditableField;
  variant: BatchVariant;
  consultants?: { id: string; full_name: string | null }[];
  compact?: boolean;
  className?: string;
}) {
  const ctx = useBatchEdit();
  if (!ctx) return null;
  const entry = ctx.entries[leadId];
  if (!entry || entry.loading) return null;
  const label = BATCH_FIELD_LABELS[field];
  const value = entry.values[field];
  const changed = entry.baseline[field] !== value;
  const error = entry.errors[field];
  const id = batchFieldDomId(leadId, field, variant);
  const set = (next: string) => ctx.setField(leadId, field, next);
  const errorId = `${id}-error`;
  // Closure reason only applies while the effective stage is terminal —
  // required there, disabled and not applicable otherwise. A stored reason on a
  // previously closed lead stays as-is unless the user changes it here.
  const terminal = TERMINAL_BATCH_STAGES.has(entry.values.funnel_stage);
  const notApplicable = field === "closure_reason" && !terminal;
  const required = field === "closure_reason" && terminal;
  const controlClass = `w-full min-w-0 rounded-lg border bg-white outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500 ${
    compact ? "px-2 text-xs" : "px-3 text-sm"
  } ${TEXTAREA.has(field) ? "h-auto py-2" : compact ? "h-9" : "h-11"} ${
    error ? "border-red-400" : changed ? "border-teal-400 bg-teal-50/60" : "border-slate-200"}`;
  const shared = { id, value, disabled: ctx.saving || notApplicable, onChange: (event: { target: { value: string } }) => set(event.target.value), "aria-invalid": !!error || undefined, "aria-required": required || undefined, "aria-label": compact ? `${label} for ${entry.snapshot.name}` : undefined, "aria-describedby": error ? errorId : undefined };

  let control: React.ReactNode;
  if (TEXT_FIELDS.has(field)) {
    control = <input {...shared} type="text" inputMode={field === "mobile" ? "tel" : undefined} className={controlClass}/>;
  } else if (DATE_FIELDS.has(field)) {
    control = <input {...shared} type="date" className={controlClass}/>;
  } else if (field === "latest_quote_sgd") {
    control = <input {...shared} type="number" min="0" max="1000000" step="0.01" className={controlClass}/>;
  } else if (TEXTAREA.has(field)) {
    control = <textarea {...shared} rows={compact ? 3 : 4} className={`${controlClass} whitespace-pre-wrap`}/>;
  } else {
    let options: React.ReactNode;
    switch (field) {
      case "owner_id":
        options = <><option value="">Select owner</option>{consultants.map(person => <option key={person.id} value={person.id}>{person.full_name ?? "Unnamed"}</option>)}</>;
        break;
      case "funnel_stage":
        options = FUNNEL_STAGES.map(stage => <option key={stage} value={stage} disabled={stage === "Won" && entry.baseline.funnel_stage !== "Won"}>{stage}</option>);
        break;
      case "closure_reason":
        options = <><option value="">No closure reason</option>{optionList(CLOSURE_REASONS)}</>;
        break;
      case "last_outcome":
        options = <><option value="">No outcome</option>{optionList(LEAD_OUTCOMES)}</>;
        break;
      case "inbound_outbound":
        options = <><option value="">Unknown direction</option>{optionList(LEAD_DIRECTIONS)}</>;
        break;
      case "contact_channel":
        options = optionList(CONTACT_CHANNELS);
        break;
      case "source":
        options = <><option value="">Unknown source</option>{optionList(LEAD_SOURCES)}</>;
        break;
      case "primary_product":
        options = <><option value="">Unknown product</option>{value && !(SELECTABLE_PRIMARY_PRODUCTS as readonly string[]).includes(value) && <option value={value}>{value === "Curtains / Blinds" ? "Curtains & Blinds" : value} (legacy — choose one to change)</option>}{optionList(SELECTABLE_PRIMARY_PRODUCTS)}</>;
        break;
      case "keys_collected":
        options = <><option value="">Unknown</option><option value="true">Collected</option><option value="false">Not collected</option></>;
        break;
      case "renovation_buying_stage":
        options = <><option value="">Not assessed</option>{optionList(BUYING_STAGES)}</>;
        break;
      case "engagement_quality":
        options = <><option value="">Not assessed</option>{optionList(ENGAGEMENT_QUALITIES)}</>;
        break;
      default:
        options = null;
    }
    control = <select {...shared} className={controlClass}>{options}</select>;
  }

  if (compact) {
    return <div className={`min-w-0 ${className}`}>{control}{error && <p id={errorId} className="mt-1 text-xs text-red-600">{error}</p>}</div>;
  }
  return <div className={`min-w-0 ${className}`}>
    <label htmlFor={id} className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-600">
      {label}
      {required && <span className="font-semibold text-red-600" aria-hidden="true">*</span>}
      {notApplicable && <span className="text-[10px] font-normal text-slate-400">not applicable — stage not closed</span>}
      {changed && <span className="rounded bg-teal-100 px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-teal-800">edited</span>}
    </label>
    {control}
    {error && <p id={errorId} className="mt-1 text-xs text-red-600">{error}</p>}
  </div>;
}

/** Shown when a save fails because the lead changed underneath the draft. */
export function BatchConflictPanel({ leadId }: { leadId: string }) {
  const ctx = useBatchEdit();
  if (!ctx) return null;
  const entry = ctx.entries[leadId];
  if (!entry?.conflict) return null;
  const latest = valuesFromSnapshot(entry.conflict);
  // Only the user's intentional changes need reconciling — untouched fields
  // automatically take the latest server value on "keep my edits".
  const diffs = BATCH_EDITABLE_FIELDS.filter(field =>
    entry.baseline[field] !== entry.values[field] && latest[field] !== entry.values[field]);
  return <section className="rounded-lg border border-slate-300 bg-slate-50 p-3" aria-label={`${entry.snapshot.name} changed elsewhere`}>
    <p className="text-sm font-medium text-slate-900">Someone else saved this lead after you opened it. Your edits were not written — nothing in the batch was saved.</p>
    {diffs.length > 0 && <ul className="mt-2 space-y-1 text-xs text-slate-700">
      {diffs.map(field => <li key={field}>
        <span className="font-medium">{BATCH_FIELD_LABELS[field]}:</span> latest “{latest[field] || "—"}” · your edit “{entry.values[field] || "—"}”
      </li>)}
    </ul>}
    <div className="mt-3 flex flex-wrap gap-2">
      <button type="button" disabled={ctx.saving} onClick={() => ctx.resolveConflict(leadId, "discard")}
        className="inline-flex h-11 items-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50">
        Discard my edits
      </button>
      <button type="button" disabled={ctx.saving} onClick={() => ctx.resolveConflict(leadId, "reapply")}
        className="inline-flex h-11 items-center rounded-lg bg-teal-600 px-3 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50">
        Keep my edits on the latest version
      </button>
    </div>
  </section>;
}

/** Lead-level (non-field) save error, e.g. archived / missing / version conflict. */
export function BatchLeadError({ leadId }: { leadId: string }) {
  const ctx = useBatchEdit();
  if (!ctx) return null;
  const message = ctx.entries[leadId]?.errors.__lead;
  if (!message) return null;
  return <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{message}</p>;
}

/** All editable fields that are not table columns — used by the expanded row and the mobile card. */
export function BatchExpandedFields({ leadId, variant, consultants }: { leadId: string; variant: BatchVariant; consultants: { id: string; full_name: string | null }[] }) {
  const ctx = useBatchEdit();
  if (!ctx) return null;
  const entry = ctx.entries[leadId];
  if (!entry || entry.loading) return null;
  return <div className="space-y-4">
    <BatchConflictPanel leadId={leadId}/>
    <BatchLeadError leadId={leadId}/>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {EXPANDED_FIELDS.map(field => <BatchField key={field} leadId={leadId} field={field} variant={variant} consultants={consultants}
        className={TEXTAREA.has(field) ? "sm:col-span-2 lg:col-span-3" : ""}/>)}
    </div>
  </div>;
}
