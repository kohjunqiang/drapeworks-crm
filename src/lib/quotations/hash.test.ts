import { describe, expect, it } from "vitest";

import {
  comparableEstimate,
  decideEstimateSnapshot,
  estimateSnapshotHash,
  matchesLegacySyncedEstimate,
  matchesStoredZohoEstimate,
  quotePayloadHash,
} from "./hash";
import { toZohoEstimatePayload } from "./model";

// A payload as syncQuotation built it before the canonical fingerprint:
// toZohoEstimatePayload emits request-only fields (discount_type,
// is_inclusive_tax, salesperson_name) that a Zoho GET never echoes back.
const legacyPayload = toZohoEstimatePayload({
  contactId: "contact-1",
  referenceNumber: "DW-2026-0042",
  issueDate: "2026-09-10",
  expiryDate: "2026-09-17",
  lines: [
    { zohoItemId: null, name: "Curtains and blinds", description: "", quantity: 1, rateCents: 120_000, discountPercent: 0 },
    { zohoItemId: "item-9", name: "Sheer", description: "day curtain", quantity: 2, rateCents: 45_000, discountPercent: 10 },
  ],
  notes: "leave with maid",
  terms: "50% deposit",
  salespersonName: "Kenny",
  templateId: "tmpl-1",
});

// The same estimate as Zoho echoes it back on GET: comparable fields identical,
// plus remote-only fields the comparator ignores.
const remoteEstimate = {
  estimate_id: "8639631000000418004",
  estimate_number: "QT-677812",
  status: "sent",
  customer_id: "contact-1",
  reference_number: "DW-2026-0042",
  date: "2026-09-10",
  expiry_date: "2026-09-17",
  template_id: "tmpl-1",
  notes: "leave with maid",
  terms: "50% deposit",
  currency_code: "SGD",
  total: 2010,
  last_modified_time: "2026-09-10T08:00:00+08:00",
  line_items: [
    { name: "Curtains and blinds", description: "", quantity: 1, rate: 1200, discount: 0 },
    { item_id: "item-9", name: "ignored when item_id present", description: "day curtain", quantity: 2, rate: 450, discount: 10 },
  ],
  custom_fields: [{ label: "CRM Quote Key", value: "dw:order-1:v1:q-1" }],
};

const remoteSnapshotHash = estimateSnapshotHash(remoteEstimate);
const storedCanonicalHash = estimateSnapshotHash(legacyPayload);
const storedLegacyRawHash = quotePayloadHash(legacyPayload);

function matchInput(remote: Record<string, unknown> = remoteEstimate) {
  return {
    remoteKey: "dw:order-1:v1:q-1",
    expectedKey: "dw:order-1:v1:q-1",
    remoteCustomerId: remote.customer_id as string,
    expectedCustomerId: "contact-1",
    remoteCurrency: remote.currency_code as string,
    remoteTotalCents: Math.round(Number(remote.total) * 100),
    expectedTotalCents: 201_000,
    remoteStatus: remote.status as string,
    remoteSnapshotHash: estimateSnapshotHash(remote),
  };
}

describe("estimateSnapshotHash", () => {
  it("gives a CRM-built payload and its remote echo the same canonical fingerprint", () => {
    expect(storedCanonicalHash).toBe(remoteSnapshotHash);
  });

  it("differs from the legacy raw-payload hash that caused the invoice mismatch", () => {
    expect(storedLegacyRawHash).not.toBe(remoteSnapshotHash);
    const comparable = comparableEstimate(legacyPayload as Record<string, unknown>);
    expect(comparable).not.toHaveProperty("discount_type");
    expect(comparable).not.toHaveProperty("is_inclusive_tax");
    expect(comparable).not.toHaveProperty("salesperson_name");
  });
});

describe("decideEstimateSnapshot", () => {
  it("accepts a quote stored with the canonical snapshot hash", () => {
    expect(decideEstimateSnapshot({ ...matchInput(), storedSnapshotHash: storedCanonicalHash })).toBe("canonical");
  });

  it("accepts a legacy raw-payload hash only after exact reconstruction", () => {
    expect(decideEstimateSnapshot({
      ...matchInput(),
      storedSnapshotHash: storedLegacyRawHash,
      legacyPayload: legacyPayload as Record<string, unknown>,
    })).toBe("legacy");
  });

  it("rejects a legacy raw-payload hash when no reconstruction is supplied", () => {
    expect(decideEstimateSnapshot({ ...matchInput(), storedSnapshotHash: storedLegacyRawHash })).toBe("reject");
  });

  it("rejects when the persisted quotation no longer reconstructs the stored payload", () => {
    const driftedPayload = { ...legacyPayload, notes: "changed after sync" };
    expect(decideEstimateSnapshot({
      ...matchInput(),
      storedSnapshotHash: storedLegacyRawHash,
      legacyPayload: driftedPayload as Record<string, unknown>,
    })).toBe("reject");
  });

  it("rejects when the remote estimate drifted after the legacy sync", () => {
    const driftedRemote = {
      ...remoteEstimate,
      line_items: [{ name: "Curtains and blinds", description: "", quantity: 1, rate: 999, discount: 0 }],
    };
    expect(decideEstimateSnapshot({
      ...matchInput(driftedRemote),
      storedSnapshotHash: storedLegacyRawHash,
      legacyPayload: legacyPayload as Record<string, unknown>,
    })).toBe("reject");
  });

  it.each([
    ["customer", { customer_id: "contact-2" }],
    ["currency", { currency_code: "USD" }],
    ["total", { total: 999 }],
    ["status", { status: "draft" }],
  ])("rejects when the remote %s gate fails even with a valid legacy payload", (_gate, patch) => {
    const remote = { ...remoteEstimate, ...patch };
    expect(decideEstimateSnapshot({
      ...matchInput(remote),
      storedSnapshotHash: storedLegacyRawHash,
      legacyPayload: legacyPayload as Record<string, unknown>,
    })).toBe("reject");
  });

  it("rejects a mismatched CRM Quote Key", () => {
    expect(decideEstimateSnapshot({
      ...matchInput(),
      remoteKey: "dw:other-order:v1:q-9",
      storedSnapshotHash: storedLegacyRawHash,
      legacyPayload: legacyPayload as Record<string, unknown>,
    })).toBe("reject");
  });

  it("rejects a missing stored hash", () => {
    expect(decideEstimateSnapshot({ ...matchInput(), storedSnapshotHash: null })).toBe("reject");
    expect(decideEstimateSnapshot({
      ...matchInput(),
      storedSnapshotHash: null,
      legacyPayload: legacyPayload as Record<string, unknown>,
    })).toBe("reject");
  });
});

describe("matchesLegacySyncedEstimate", () => {
  it("requires both the exact stored hash and the canonical remote match", () => {
    expect(matchesLegacySyncedEstimate({
      storedSnapshotHash: storedLegacyRawHash,
      legacyPayload: legacyPayload as Record<string, unknown>,
      remoteSnapshotHash,
    })).toBe(true);
    expect(matchesLegacySyncedEstimate({
      storedSnapshotHash: "deadbeef",
      legacyPayload: legacyPayload as Record<string, unknown>,
      remoteSnapshotHash,
    })).toBe(false);
    expect(matchesLegacySyncedEstimate({
      storedSnapshotHash: storedLegacyRawHash,
      legacyPayload: legacyPayload as Record<string, unknown>,
      remoteSnapshotHash: "deadbeef",
    })).toBe(false);
  });
});

describe("matchesStoredZohoEstimate", () => {
  it("still enforces every gate alongside the snapshot hash", () => {
    const base = { ...matchInput(), storedSnapshotHash: remoteSnapshotHash };
    expect(matchesStoredZohoEstimate(base)).toBe(true);
    expect(matchesStoredZohoEstimate({ ...base, remoteStatus: "draft" })).toBe(false);
    expect(matchesStoredZohoEstimate({ ...base, remoteCustomerId: "contact-2" })).toBe(false);
    expect(matchesStoredZohoEstimate({ ...base, remoteCurrency: "USD" })).toBe(false);
    expect(matchesStoredZohoEstimate({ ...base, remoteTotalCents: 1 })).toBe(false);
    expect(matchesStoredZohoEstimate({ ...base, storedSnapshotHash: null })).toBe(false);
  });
});
