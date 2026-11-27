// Isomorphic helpers for the cross-page batch editor: shared by the server
// action (types), the client draft store, and tests. Keep free of React,
// Next, and database imports.
import type { FunnelStage } from "./funnel-types";

export const BATCH_EDITABLE_FIELDS = [
  "name", "owner_id", "funnel_stage", "closure_reason", "last_outcome",
  "next_action_date", "move_in_date", "action_detail", "mobile", "development",
  "inbound_outbound", "contact_channel", "source", "primary_product",
  "keys_collected", "interaction_summary", "quotation_breakdown",
  "historical_summary", "latest_quote_note", "renovation_buying_stage",
  "engagement_quality", "latest_quote_sgd",
] as const;
export type BatchEditableField = (typeof BATCH_EDITABLE_FIELDS)[number];
export type BatchDraftValues = Record<BatchEditableField, string>;

/** Latest server-side state of the editable fields, as fetched for editing. */
export interface LeadBatchSnapshot {
  id: string;
  updated_at: string;
  is_archived: boolean;
  name: string;
  funnel_stage: FunnelStage;
  closure_reason: string | null;
  last_outcome: string | null;
  next_action_date_text: string | null;
  move_in_date_text: string | null;
  action_detail: string | null;
  mobile: string | null;
  development: string | null;
  inbound_outbound: string | null;
  contact_channel: string;
  source: string | null;
  primary_product: string | null;
  keys_collected: boolean | null;
  interaction_summary: string | null;
  quotation_breakdown: string | null;
  historical_summary: string | null;
  latest_quote_note: string | null;
  renovation_buying_stage: string | null;
  engagement_quality: string | null;
  latest_quote_cents: number | null;
  assigned_consultant_id: string | null;
  owner_id: string | null;
}

export type LeadBatchErrorKind = "missing" | "archived" | "conflict" | "validation";
export interface LeadBatchError {
  leadId: string;
  kind: LeadBatchErrorKind;
  field?: string;
  message: string;
  latest?: LeadBatchSnapshot;
}

const quoteToSgd = (cents: number | null) => cents === null ? "" : String(cents / 100);

/** Snapshot → form-string draft values ("" = empty/clear). */
export function valuesFromSnapshot(row: LeadBatchSnapshot): BatchDraftValues {
  return {
    name: row.name,
    owner_id: row.assigned_consultant_id ?? row.owner_id ?? "",
    funnel_stage: row.funnel_stage,
    closure_reason: row.closure_reason ?? "",
    last_outcome: row.last_outcome ?? "",
    next_action_date: row.next_action_date_text ?? "",
    move_in_date: row.move_in_date_text ?? "",
    action_detail: row.action_detail ?? "",
    mobile: row.mobile ?? "",
    development: row.development ?? "",
    inbound_outbound: row.inbound_outbound ?? "",
    contact_channel: row.contact_channel ?? "",
    source: row.source ?? "",
    primary_product: row.primary_product ?? "",
    keys_collected: row.keys_collected === null ? "" : String(row.keys_collected),
    interaction_summary: row.interaction_summary ?? "",
    quotation_breakdown: row.quotation_breakdown ?? "",
    historical_summary: row.historical_summary ?? "",
    latest_quote_note: row.latest_quote_note ?? "",
    renovation_buying_stage: row.renovation_buying_stage ?? "",
    engagement_quality: row.engagement_quality ?? "",
    latest_quote_sgd: quoteToSgd(row.latest_quote_cents),
  };
}

export function changedFields(baseline: BatchDraftValues, values: BatchDraftValues): BatchEditableField[] {
  return BATCH_EDITABLE_FIELDS.filter(field => baseline[field] !== values[field]);
}

/** Only changed keys are sent; "" is meaningful (explicit clear) for nullable fields. */
export function buildPatch(baseline: BatchDraftValues, values: BatchDraftValues): Record<BatchEditableField, string> & object {
  const patch: Partial<Record<BatchEditableField, string>> = {};
  for (const field of changedFields(baseline, values)) patch[field] = values[field];
  return patch as Record<BatchEditableField, string> & object;
}

/**
 * Reapply a draft onto a newer snapshot after an optimistic-lock conflict:
 * keep the latest server values for everything, overlaying ONLY the fields the
 * user actually changed — so another editor's updates to untouched fields are
 * never overwritten by our stale copies.
 */
export function reapplyChangedValues(latest: BatchDraftValues, oldBaseline: BatchDraftValues, oldValues: BatchDraftValues): BatchDraftValues {
  const merged = { ...latest };
  for (const field of changedFields(oldBaseline, oldValues)) merged[field] = oldValues[field];
  return merged;
}

/**
 * Remove a lead's stale save errors after its draft was resolved, discarded,
 * or deselected — or, when a field is given, only that field's error after the
 * user corrected it. Other leads' and unrelated errors are kept.
 */
export function pruneLeadErrors(errors: LeadBatchError[], leadId: string, field?: string): LeadBatchError[] {
  return errors.filter(error => error.leadId !== leadId || (field !== undefined && error.field !== field));
}

// --- Session draft storage -------------------------------------------------
// Drafts persist in sessionStorage so browser Back/Forward away from /leads
// can restore them. Identity is the authenticated user's id — never any
// cookie or token contents, which are neither unique nor stable.

export const BATCH_DRAFT_STORAGE_PREFIX = "drapeworks:lead-batch-drafts";
export const BATCH_DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const BATCH_DRAFT_MAX_LEADS = 50;

/** Normalized result context: filters/sort/view/pageSize, excluding page. */
export function batchContextKey(search: string): string {
  const params = new URLSearchParams(search);
  params.delete("page");
  params.sort();
  return params.toString();
}

export function batchDraftStorageKey(actorId: string, contextKey: string): string {
  return `${BATCH_DRAFT_STORAGE_PREFIX}:${actorId}:${contextKey}`;
}

/** Remove every stored draft not owned by this actor (account switch on a shared tab). */
export function pruneForeignDraftKeys(storage: { length: number; key: (index: number) => string | null; removeItem: (key: string) => void }, actorId: string): void {
  const ours = `${BATCH_DRAFT_STORAGE_PREFIX}:${actorId}:`;
  const stale: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(`${BATCH_DRAFT_STORAGE_PREFIX}:`) && !key.startsWith(ours)) stale.push(key);
  }
  for (const key of stale) storage.removeItem(key);
}

/** Parse persisted drafts — bounded to 50 leads, non-loading, unexpired — or null. */
export function parseStoredDrafts<T extends { loading?: boolean }>(raw: string | null, now: number, maxAgeMs = BATCH_DRAFT_MAX_AGE_MS): { entries: Record<string, T>; order: string[] } | null {
  if (!raw) return null;
  let data: { entries?: Record<string, T>; order?: unknown; savedAt?: unknown };
  try { data = JSON.parse(raw); } catch { return null; }
  if (typeof data?.savedAt !== "number" || now - data.savedAt > maxAgeMs) return null;
  const byId = data.entries ?? {};
  const order = (Array.isArray(data.order) ? data.order : [])
    .filter((id): id is string => typeof id === "string" && byId[id] !== undefined && !byId[id].loading)
    .slice(0, BATCH_DRAFT_MAX_LEADS);
  return order.length ? { entries: Object.fromEntries(order.map(id => [id, byId[id]])), order } : null;
}

/** Fields rendered as a multi-line textarea rather than a single-line input. */
export const TEXTAREA_FIELDS: readonly BatchEditableField[] = [
  "action_detail", "interaction_summary", "quotation_breakdown",
  "historical_summary", "latest_quote_note",
];

/** Fields shown on the expandable "more fields" section rather than a table cell. */
export const EXPANDED_FIELDS: readonly BatchEditableField[] = [
  "owner_id", "mobile", "development", "contact_channel", "source",
  "primary_product", "move_in_date", "keys_collected", "closure_reason",
  "renovation_buying_stage", "engagement_quality", "latest_quote_sgd",
  "latest_quote_note", "interaction_summary", "historical_summary",
  "quotation_breakdown",
];

export const TERMINAL_BATCH_STAGES = new Set(["Lost", "Not Qualified"]);

/** Field-name → human label, for error summaries and review lists. */
export const BATCH_FIELD_LABELS: Record<BatchEditableField, string> = {
  name: "Customer name",
  owner_id: "Owner",
  funnel_stage: "Funnel stage",
  closure_reason: "Closure reason",
  last_outcome: "Last contact outcome",
  next_action_date: "Next action date",
  move_in_date: "Move-in date",
  action_detail: "Action detail",
  mobile: "Mobile",
  development: "Development",
  inbound_outbound: "Inbound / Outbound",
  contact_channel: "Contact channel",
  source: "Source",
  primary_product: "Primary product",
  keys_collected: "Keys collected",
  interaction_summary: "Interaction summary",
  quotation_breakdown: "Quotation breakdown",
  historical_summary: "Historical summary",
  latest_quote_note: "Latest quotation note",
  renovation_buying_stage: "Renovation / Buying stage",
  engagement_quality: "Engagement quality",
  latest_quote_sgd: "Latest quotation value (SGD)",
};
