import { createHash } from "node:crypto";

import { stableJson } from "./model";

export function quotePayloadHash(payload: unknown): string {
  return createHash("sha256").update(stableJson(payload)).digest("hex");
}

// Canonical snapshot of a Zoho estimate used for every stored fingerprint.
// Fields mirror exactly what Zoho echoes back on a GET, so the hash of this
// shape is comparable between the outbound payload and the remote document.
export function comparableEstimate(value: Record<string, unknown>) {
  const lines = Array.isArray(value.line_items) ? value.line_items as Array<Record<string, unknown>> : [];
  return {
    customer_id: value.customer_id ?? "",
    reference_number: value.reference_number ?? "",
    date: value.date ?? "",
    expiry_date: value.expiry_date ?? "",
    template_id: value.template_id ?? "",
    notes: value.notes ?? "",
    terms: value.terms ?? "",
    line_items: lines.map((line) => ({
      ...(line.item_id ? { item_id: String(line.item_id) } : { name: String(line.name ?? "") }),
      description: String(line.description ?? ""), quantity: Number(line.quantity), rate: Number(line.rate), discount: Number.parseFloat(String(line.discount ?? 0)) || 0,
    })),
  };
}

export function estimateSnapshotHash(value: Record<string, unknown>): string {
  return quotePayloadHash(comparableEstimate(value));
}

// Fingerprint binding a review-and-apply preview to one remote state. Unlike
// the synced snapshot hash, this covers everything the reviewer saw or that a
// guard relies on — identity, status, invoice linkage, customer, currency,
// totals, dates, notes, terms, reference/template, every discount/tax/
// adjustment/shipping field, the raw CRM-key custom fields, and each line's
// raw name, description and discount metadata — so a materially changed
// remote can never slip through with an unchanged timestamp or total.
export function zohoAdoptionFingerprint(value: Record<string, unknown>): string {
  const lines = Array.isArray(value.line_items) ? value.line_items as Array<Record<string, unknown>> : [];
  const customFields = Array.isArray(value.custom_fields) ? value.custom_fields as Array<Record<string, unknown>> : [];
  return quotePayloadHash({
    estimate_id: String(value.estimate_id ?? ""),
    estimate_number: String(value.estimate_number ?? ""),
    status: String(value.status ?? ""),
    customer_id: String(value.customer_id ?? ""),
    currency_code: String(value.currency_code ?? ""),
    total: String(value.total ?? ""),
    sub_total: String(value.sub_total ?? ""),
    date: String(value.date ?? ""),
    expiry_date: String(value.expiry_date ?? ""),
    reference_number: String(value.reference_number ?? ""),
    template_id: String(value.template_id ?? ""),
    notes: String(value.notes ?? ""),
    terms: String(value.terms ?? ""),
    discount: String(value.discount ?? ""),
    discount_type: String(value.discount_type ?? ""),
    is_inclusive_tax: Boolean(value.is_inclusive_tax),
    tax_total: String(value.tax_total ?? ""),
    taxes: value.taxes ?? null,
    adjustment: String(value.adjustment ?? ""),
    shipping_charge: String(value.shipping_charge ?? ""),
    last_modified_time: String(value.last_modified_time ?? ""),
    invoice_ids: Array.isArray(value.invoice_ids) ? [...value.invoice_ids].map(String).sort() : [],
    custom_fields: customFields.map((field) => ({
      customfield_id: String(field.customfield_id ?? ""),
      api_name: String(field.api_name ?? ""),
      label: String(field.label ?? ""),
      value: field.value ?? null,
    })),
    line_items: lines.map((line) => ({
      item_id: String(line.item_id ?? ""),
      name: String(line.name ?? ""),
      description: String(line.description ?? ""),
      quantity: String(line.quantity ?? ""),
      rate: String(line.rate ?? ""),
      discount: String(line.discount ?? ""),
      discount_amount: String(line.discount_amount ?? ""),
      tax_id: String(line.tax_id ?? ""),
      tax_percentage: String(line.tax_percentage ?? ""),
      item_total: String(line.item_total ?? ""),
    })),
  });
}

// Quotations synced before the canonical fingerprint stored
// hash(full Zoho request payload) in synced_payload_hash. That legacy value is
// only acceptable when it EXACTLY equals the hash of a payload reconstructed
// from the persisted quotation, AND the canonical form of that reconstruction
// EXACTLY equals the canonical remote snapshot — so drift in lines, notes,
// dates, or any other field still rejects.
export function matchesLegacySyncedEstimate(input: {
  storedSnapshotHash: string | null;
  legacyPayload: Record<string, unknown>;
  remoteSnapshotHash: string;
}): boolean {
  return Boolean(input.storedSnapshotHash)
    && input.storedSnapshotHash === quotePayloadHash(input.legacyPayload)
    && estimateSnapshotHash(input.legacyPayload) === input.remoteSnapshotHash;
}

// Invoice-time decision over a live remote estimate. "canonical" means the
// stored fingerprint already matches the remote snapshot; "legacy" means a
// pre-canonical raw payload hash was re-verified by exact reconstruction;
// "reject" means any gate or both fingerprints failed.
export function decideEstimateSnapshot(input: {
  remoteKey: unknown;
  expectedKey: string;
  remoteCustomerId: string | undefined;
  expectedCustomerId: string;
  remoteCurrency: string | undefined;
  remoteTotalCents: number;
  expectedTotalCents: number;
  remoteStatus: string;
  remoteSnapshotHash: string;
  storedSnapshotHash: string | null;
  legacyPayload?: Record<string, unknown> | null;
}): "canonical" | "legacy" | "reject" {
  const { legacyPayload, ...gates } = input;
  if (matchesStoredZohoEstimate({ ...gates, storedSnapshotHash: input.storedSnapshotHash })) return "canonical";
  // Re-run the gates with the remote snapshot as its own stored value so only
  // the non-hash gates (key, customer, currency, total, status) are evaluated.
  const nonHashGatesMatch = matchesStoredZohoEstimate({ ...gates, storedSnapshotHash: input.remoteSnapshotHash });
  if (nonHashGatesMatch && legacyPayload && matchesLegacySyncedEstimate({
    storedSnapshotHash: input.storedSnapshotHash,
    legacyPayload,
    remoteSnapshotHash: input.remoteSnapshotHash,
  })) return "legacy";
  return "reject";
}

export function matchesStoredZohoEstimate(input: {
  remoteKey: unknown;
  expectedKey: string;
  remoteCustomerId: string | undefined;
  expectedCustomerId: string;
  remoteCurrency: string | undefined;
  remoteTotalCents: number;
  expectedTotalCents: number;
  remoteStatus: string;
  remoteSnapshotHash: string;
  storedSnapshotHash: string | null;
}): boolean {
  const keyMatches = !input.remoteKey || input.remoteKey === input.expectedKey;
  return keyMatches &&
    Boolean(input.storedSnapshotHash) &&
    ["sent", "accepted", "invoiced"].includes(input.remoteStatus) &&
    input.remoteCustomerId === input.expectedCustomerId &&
    input.remoteCurrency === "SGD" &&
    input.remoteTotalCents === input.expectedTotalCents &&
    input.remoteSnapshotHash === input.storedSnapshotHash;
}
