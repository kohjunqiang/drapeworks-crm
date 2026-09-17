import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  selectFrom: vi.fn(),
  updateTable: vi.fn(),
  requireRole: vi.fn(),
  requireSession: vi.fn(),
  revalidatePath: vi.fn(),
  getZohoEstimate: vi.fn(),
  getZohoBooksBinding: vi.fn(),
  assertZohoCustomerPaymentsReady: vi.fn(),
  listZohoCustomerPayments: vi.fn(),
  getZohoInvoice: vi.fn(),
  convertZohoEstimateToInvoice: vi.fn(),
  createZohoCustomerPayment: vi.fn(),
  getZohoCustomerPayment: vi.fn(),
  getZohoDepositPaymentConfig: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth/require-role", () => ({
  requireRole: mocks.requireRole,
  requireSession: mocks.requireSession,
}));
vi.mock("@/lib/db/kysely", () => ({
  db: {
    transaction: mocks.transaction,
    selectFrom: mocks.selectFrom,
    updateTable: mocks.updateTable,
  },
}));
vi.mock("@/lib/supabase/admin", () => ({ adminClient: vi.fn() }));
vi.mock("@/lib/zoho/books", () => ({
  getZohoEstimate: mocks.getZohoEstimate,
  getZohoBooksBinding: mocks.getZohoBooksBinding,
  assertZohoCustomerPaymentsReady: mocks.assertZohoCustomerPaymentsReady,
  listZohoCustomerPayments: mocks.listZohoCustomerPayments,
  getZohoInvoice: mocks.getZohoInvoice,
  convertZohoEstimateToInvoice: mocks.convertZohoEstimateToInvoice,
  createZohoCustomerPayment: mocks.createZohoCustomerPayment,
  getZohoCustomerPayment: mocks.getZohoCustomerPayment,
  getZohoDepositPaymentConfig: mocks.getZohoDepositPaymentConfig,
}));

import { estimateSnapshotHash, quotePayloadHash } from "@/lib/quotations/hash";
import { toZohoEstimatePayload } from "@/lib/quotations/model";
import { ensureZohoInvoiceForOrder, ensureZohoInvoiceForOrderUi } from "./quotations";

const ORDER_ID = "a31fd642-0fe2-4066-9762-880b0e023471";
const QUOTE_ID = "b31fd642-0fe2-4066-9762-880b0e023472";

const LINES = [
  { zohoItemId: null, name: "Curtains and blinds", description: "", quantity: 1, rateCents: 120_000, discountPercent: 0 },
  { zohoItemId: "item-9", name: "Sheer", description: "day curtain", quantity: 2, rateCents: 45_000, discountPercent: 10 },
];

// What the action rebuilds for a legacy raw-hash quotation: the exact payload
// syncQuotation sent, reconstructed from persisted quote + order + consultant
// + org binding.
const legacyPayload = toZohoEstimatePayload({
  contactId: "contact-1",
  referenceNumber: "DW-1",
  issueDate: "2026-09-10",
  expiryDate: "2026-09-17",
  lines: LINES,
  notes: "leave with maid",
  terms: "50% deposit",
  salespersonName: "Kenny",
  templateId: "tmpl-1",
});
const LEGACY_RAW_HASH = quotePayloadHash(legacyPayload);
const CANONICAL_HASH = estimateSnapshotHash(legacyPayload as Record<string, unknown>);

function makeRemote(patch: Record<string, unknown> = {}) {
  return {
    estimate_id: "est-1",
    estimate_number: "QT-677812",
    status: "sent",
    customer_id: "contact-1",
    reference_number: "DW-1",
    date: "2026-09-10",
    expiry_date: "2026-09-17",
    template_id: "tmpl-1",
    notes: "leave with maid",
    terms: "50% deposit",
    currency_code: "SGD",
    total: 2010,
    invoice_ids: [],
    line_items: [
      { name: "Curtains and blinds", description: "", quantity: 1, rate: 1200, discount: 0 },
      { item_id: "item-9", description: "day curtain", quantity: 2, rate: 450, discount: 10 },
    ],
    custom_fields: [{ label: "CRM Quote Key", value: "dw:o-1:v1:q-1" }],
    ...patch,
  };
}

function makeQuote(storedHash: string | null) {
  return {
    id: QUOTE_ID,
    order_id: ORDER_ID,
    status: "sent",
    crm_quote_key: "dw:o-1:v1:q-1",
    issue_date: "2026-09-10",
    expiry_date: "2026-09-17",
    lines: LINES,
    quoted_total_cents: 201_000,
    notes: "leave with maid",
    terms: "50% deposit",
    zoho_contact_id: "contact-1",
    zoho_estimate_id: "est-1",
    synced_payload_hash: storedHash,
    zoho_invoice_id: null,
    zoho_invoice_number: null,
    invoice_sync_state: "not_started",
    invoice_claimed_at: null,
    invoice_claim_token: null,
    invoice_uncertain_at: null,
    invoice_sync_error: null,
    payment_sync_state: "not_started",
    payment_claimed_at: null,
    payment_claim_token: null,
    payment_uncertain_at: null,
    payment_sync_error: null,
    zoho_payment_id: null,
    superseded_at: null,
  };
}

function builder(result: unknown) {
  const chain = {
    select: () => chain,
    selectAll: () => chain,
    where: () => chain,
    forUpdate: () => chain,
    set: () => chain,
    values: () => chain,
    returning: () => chain,
    onConflict: () => chain,
    execute: async () => [] as unknown[],
    executeTakeFirst: async () => result,
    executeTakeFirstOrThrow: async () => {
      if (result === undefined) throw new Error("missing fake row");
      return result;
    },
  };
  return chain;
}

function setup({ quote, remote }: { quote: ReturnType<typeof makeQuote>; remote: ReturnType<typeof makeRemote> }) {
  const order = {
    current_status: "quotation_sent",
    deposit_cents: 100_000,
    display_id: "DW-1",
    order_reference: "DW-1",
    consultant_id: "consult-1",
  };
  const trx = {
    selectFrom: (table: string) =>
      builder(table === "orders" ? order : table === "order_quotations" ? quote : undefined),
    updateTable: () => builder({ id: QUOTE_ID }),
    insertInto: () => builder({}),
  };
  mocks.transaction.mockReturnValue({ execute: async (cb: (tx: typeof trx) => unknown) => cb(trx) });
  mocks.selectFrom.mockImplementation((table: string) =>
    builder(table === "profiles" ? { full_name: "Kenny" } : undefined));
  mocks.updateTable.mockImplementation(() => builder({ id: QUOTE_ID }));
  mocks.getZohoEstimate.mockResolvedValue(remote);
  mocks.getZohoBooksBinding.mockResolvedValue({
    crmKeyFieldId: "cf-1",
    crmKeyApiName: "cf_crm_quote_key",
    estimateTemplateId: "tmpl-1",
  });
  mocks.assertZohoCustomerPaymentsReady.mockResolvedValue(undefined);
  mocks.listZohoCustomerPayments.mockResolvedValue([]);
  mocks.getZohoDepositPaymentConfig.mockReturnValue({ accountId: "acc-1", paymentMode: "PayNow" });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.requireRole.mockResolvedValue({ user: { id: "ops-user" }, profile: { role: "admin" } });
  mocks.requireSession.mockResolvedValue({ user: { id: "ops-user" }, profile: { role: "admin" } });
});

describe("ensureZohoInvoiceForOrder legacy raw-hash compatibility", () => {
  it("reconstructs the stored raw payload hash and proceeds to invoicing", async () => {
    setup({ quote: makeQuote(LEGACY_RAW_HASH), remote: makeRemote() });
    mocks.convertZohoEstimateToInvoice.mockResolvedValue({ invoice_id: "inv-1", invoice_number: "INV-1" });
    // Stop the flow at invoice verification so the test stays at this boundary.
    mocks.getZohoInvoice.mockRejectedValue(new Error("stop-here"));

    await expect(ensureZohoInvoiceForOrder(ORDER_ID)).rejects.toThrow("stop-here");

    // The legacy hash was accepted: the remote snapshot check passed and the
    // action reached conversion on THIS estimate — never a payment write.
    expect(mocks.assertZohoCustomerPaymentsReady).toHaveBeenCalled();
    expect(mocks.convertZohoEstimateToInvoice).toHaveBeenCalledWith("est-1");
    expect(mocks.createZohoCustomerPayment).not.toHaveBeenCalled();
  });

  it("accepts a canonical stored hash without reconstructing the legacy payload", async () => {
    setup({ quote: makeQuote(CANONICAL_HASH), remote: makeRemote() });
    mocks.convertZohoEstimateToInvoice.mockResolvedValue({ invoice_id: "inv-1" });
    mocks.getZohoInvoice.mockRejectedValue(new Error("stop-here"));

    await expect(ensureZohoInvoiceForOrder(ORDER_ID)).rejects.toThrow("stop-here");

    expect(mocks.convertZohoEstimateToInvoice).toHaveBeenCalledWith("est-1");
    // profiles is only read while reconstructing a legacy payload.
    expect(mocks.selectFrom).not.toHaveBeenCalledWith("profiles");
  });

  it("rejects a drifted remote estimate before any invoice or payment call", async () => {
    const drifted = makeRemote({
      line_items: [{ name: "Curtains and blinds", description: "changed", quantity: 1, rate: 1200, discount: 0 }],
    });
    setup({ quote: makeQuote(LEGACY_RAW_HASH), remote: drifted });

    const result = await ensureZohoInvoiceForOrderUi(ORDER_ID);

    expect(result).toEqual({
      ok: false,
      error: "The sent Zoho quotation no longer matches the CRM snapshot; reconcile it before creating an invoice",
    });
    expect(mocks.assertZohoCustomerPaymentsReady).not.toHaveBeenCalled();
    expect(mocks.convertZohoEstimateToInvoice).not.toHaveBeenCalled();
    expect(mocks.createZohoCustomerPayment).not.toHaveBeenCalled();
  });

  it("rejects when the remote customer gate fails even with a valid stored hash", async () => {
    setup({ quote: makeQuote(LEGACY_RAW_HASH), remote: makeRemote({ customer_id: "contact-2" }) });

    const result = await ensureZohoInvoiceForOrderUi(ORDER_ID);

    expect(result.ok).toBe(false);
    expect(mocks.convertZohoEstimateToInvoice).not.toHaveBeenCalled();
    expect(mocks.createZohoCustomerPayment).not.toHaveBeenCalled();
  });
});

describe("deposit payment raw-error sanitization", () => {
  it("reports the uncertainty guidance without leaking the raw SDK error", async () => {
    // Remote already links the invoice so the flow reaches the payment stage.
    setup({ quote: makeQuote(CANONICAL_HASH), remote: makeRemote({ invoice_ids: ["inv-1"] }) });
    mocks.getZohoInvoice.mockResolvedValue({
      invoice_id: "inv-1",
      invoice_number: "INV-1",
      status: "sent",
      customer_id: "contact-1",
      currency_code: "SGD",
      total: 2010,
    });
    mocks.createZohoCustomerPayment.mockRejectedValue(new Error("RAW-SECRET-401 oauth_token=abc123"));

    vi.useFakeTimers();
    try {
      const pending = ensureZohoInvoiceForOrderUi(ORDER_ID);
      await vi.advanceTimersByTimeAsync(10_000);
      const result = await pending;

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("may have recorded the deposit payment");
        expect(result.error).toContain("locked meanwhile");
        expect(result.error).not.toContain("RAW-SECRET");
        expect(result.error).not.toContain("abc123");
      }
      expect(mocks.createZohoCustomerPayment).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns the generic fallback for an unexpected infrastructure error", async () => {
    setup({ quote: makeQuote(CANONICAL_HASH), remote: makeRemote() });
    mocks.getZohoEstimate.mockRejectedValue(new Error("RAW-SECRET-401 oauth_token=abc123"));

    const result = await ensureZohoInvoiceForOrderUi(ORDER_ID);

    expect(result).toEqual({
      ok: false,
      error: "The Zoho invoice and deposit could not be recorded. Refresh the order and try again.",
    });
    expect(mocks.convertZohoEstimateToInvoice).not.toHaveBeenCalled();
  });
});
