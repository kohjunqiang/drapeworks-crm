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
  findZohoEstimateByNumber: vi.fn(),
  findZohoInvoicesByNumber: vi.fn(),
  getZohoEstimatePdf: vi.fn(),
  markZohoEstimateSent: vi.fn(),
  syncZohoEstimate: vi.fn(),
  adminClient: vi.fn(),
  assertZohoCustomerPaymentsReady: vi.fn(),
  assertZohoInvoiceNumberingReady: vi.fn(),
  listZohoCustomerPayments: vi.fn(),
  getZohoInvoice: vi.fn(),
  convertZohoEstimateToInvoice: vi.fn(),
  renameZohoInvoice: vi.fn(),
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
vi.mock("@/lib/supabase/admin", () => ({ adminClient: mocks.adminClient }));
vi.mock("@/lib/zoho/books", () => ({
  getZohoEstimate: mocks.getZohoEstimate,
  getZohoBooksBinding: mocks.getZohoBooksBinding,
  findZohoEstimateByNumber: mocks.findZohoEstimateByNumber,
  findZohoInvoicesByNumber: mocks.findZohoInvoicesByNumber,
  getZohoEstimatePdf: mocks.getZohoEstimatePdf,
  markZohoEstimateSent: mocks.markZohoEstimateSent,
  syncZohoEstimate: mocks.syncZohoEstimate,
  assertZohoCustomerPaymentsReady: mocks.assertZohoCustomerPaymentsReady,
  assertZohoInvoiceNumberingReady: mocks.assertZohoInvoiceNumberingReady,
  listZohoCustomerPayments: mocks.listZohoCustomerPayments,
  getZohoInvoice: mocks.getZohoInvoice,
  convertZohoEstimateToInvoice: mocks.convertZohoEstimateToInvoice,
  renameZohoInvoice: mocks.renameZohoInvoice,
  createZohoCustomerPayment: mocks.createZohoCustomerPayment,
  getZohoCustomerPayment: mocks.getZohoCustomerPayment,
  getZohoDepositPaymentConfig: mocks.getZohoDepositPaymentConfig,
}));

import { estimateSnapshotHash, quotePayloadHash, zohoAdoptionFingerprint } from "@/lib/quotations/hash";
import { QUOTATION_INVOICED_MESSAGE } from "@/lib/quotations/lifecycle";
import { defaultCustomerMessage, toLegacyZohoEstimatePayload } from "@/lib/quotations/model";
import { ZohoEstimateConversionRejectedError } from "@/lib/zoho/conversion-error";
import { invoiceFingerprint, orderReconciliationFingerprint } from "@/lib/quotations/invoice-reconciliation";
import { acknowledgeZohoConflict, reconcileInvoicedZohoQuotation, adoptZohoQuotation, confirmQuotationSent, createQuotationRevision, ensureZohoInvoiceForOrder, ensureZohoInvoiceForOrderUi, importExistingZohoQuotation, overwriteZohoWithCrmQuotation, previewQuotationZohoDiff, saveQuotation, saveQuotationUi, syncQuotation, syncQuotationUi } from "./quotations";

const ORDER_ID = "a31fd642-0fe2-4066-9762-880b0e023471";
const QUOTE_ID = "b31fd642-0fe2-4066-9762-880b0e023472";

const LINES = [
  { zohoItemId: null, name: "Curtains and blinds", description: "", quantity: 1, rateCents: 120_000, discountPercent: 0 },
  { zohoItemId: "item-9", name: "Sheer", description: "day curtain", quantity: 2, rateCents: 45_000, discountPercent: 10 },
];

// What the action rebuilds for a legacy raw-hash quotation: the exact payload
// syncQuotation sent, reconstructed from persisted quote + order + consultant
// + org binding. Frozen as a literal with the historical bare-number
// discounts — building it from the live outbound builder (which now sends
// "10%") would conceal a regression in the byte-for-byte reconstruction.
const LEGACY_INPUT = {
  contactId: "contact-1",
  referenceNumber: "DW-1",
  issueDate: "2026-09-10",
  expiryDate: "2026-09-17",
  lines: LINES,
  notes: "leave with maid",
  terms: "50% deposit",
  salespersonName: "Kenny",
  templateId: "tmpl-1",
};
const legacyPayload = {
  customer_id: "contact-1",
  reference_number: "DW-1",
  date: "2026-09-10",
  expiry_date: "2026-09-17",
  discount_type: "item_level",
  is_inclusive_tax: false,
  template_id: "tmpl-1",
  salesperson_name: "Kenny",
  notes: "leave with maid",
  terms: "50% deposit",
  line_items: [
    { name: "Curtains and blinds", description: "", quantity: 1, rate: 1200, discount: 0 },
    { item_id: "item-9", description: "day curtain", quantity: 2, rate: 450, discount: 10 },
  ],
};
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
    zoho_estimate_number: "QT-677816",
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
    sent_at: null as Date | null,
    updated_at: new Date("2026-09-22T04:03:36.347Z"),
  };
}

// Every updateTable(...).set(...) payload, in call order, so tests can assert
// what the actions actually persisted.
const setCalls: Array<Record<string, unknown>> = [];

// Every insertInto(...).values(...) payload, in call order — same idea.
const insertCalls: Array<Record<string, unknown>> = [];

function builder(result: unknown) {
  const chain = {
    select: () => chain,
    selectAll: () => chain,
    innerJoin: () => chain,
    leftJoin: () => chain,
    where: () => chain,
    forUpdate: () => chain,
    set: (values: Record<string, unknown>) => { setCalls.push(values); return chain; },
    values: (values: Record<string, unknown>) => { insertCalls.push(values); return chain; },
    returning: () => chain,
    returningAll: () => chain,
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
  mocks.assertZohoInvoiceNumberingReady.mockResolvedValue(undefined);
  mocks.listZohoCustomerPayments.mockResolvedValue([]);
  mocks.getZohoDepositPaymentConfig.mockReturnValue({ accountId: "acc-1", paymentMode: "PayNow" });
}

beforeEach(() => {
  vi.clearAllMocks();
  setCalls.length = 0;
  insertCalls.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.requireRole.mockResolvedValue({ user: { id: "ops-user" }, profile: { role: "admin" } });
  mocks.requireSession.mockResolvedValue({ user: { id: "ops-user" }, profile: { role: "admin" } });
  mocks.findZohoInvoicesByNumber.mockResolvedValue([]);
});

describe("ensureZohoInvoiceForOrder legacy raw-hash compatibility", () => {
  it("rebuilds the frozen historical payload, bare-number discounts included", () => {
    expect(toLegacyZohoEstimatePayload(LEGACY_INPUT)).toEqual(legacyPayload);
  });

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

describe("Zoho-owned invoice numbering and conversion outcomes", () => {
  // The estimate gains its invoice link only after conversion: a first read
  // without invoice_ids lets the action convert, later reads carry the link
  // for verification.
  const unlinkedRemote = () => makeRemote({ estimate_number: "QT-677816", invoice_ids: [] });
  const linkedRemote = () => makeRemote({ estimate_number: "QT-677816", invoice_ids: ["inv-1"] });
  const zohoInvoice = () => ({ invoice_id: "inv-1", invoice_number: "INV-900001", status: "sent", customer_id: "contact-1", currency_code: "SGD", total: 2010 });
  const recordedPayment = () => {
    mocks.createZohoCustomerPayment.mockResolvedValue({ payment_id: "pay-1", payment_number: "91" });
    mocks.getZohoCustomerPayment.mockResolvedValue({
      payment_id: "pay-1", payment_number: "91", customer_id: "contact-1",
      payment_mode: "PayNow", amount: 1000, account_id: "acc-1",
      invoices: [{ invoice_id: "inv-1", invoice_number: "INV-900001", amount_applied: 1000 }],
    });
  };

  it("keeps the Zoho-assigned invoice number and records the deposit against it", async () => {
    setup({ quote: makeQuote(CANONICAL_HASH), remote: linkedRemote() });
    mocks.getZohoEstimate.mockResolvedValueOnce(unlinkedRemote());
    mocks.convertZohoEstimateToInvoice.mockResolvedValue({ invoice_id: "inv-1", invoice_number: "INV-900001" });
    mocks.getZohoInvoice.mockResolvedValue(zohoInvoice());
    recordedPayment();

    await expect(ensureZohoInvoiceForOrder(ORDER_ID)).resolves.toBeUndefined();

    expect(mocks.convertZohoEstimateToInvoice).toHaveBeenCalledWith("est-1");
    expect(mocks.convertZohoEstimateToInvoice).toHaveBeenCalledTimes(1);
    expect(mocks.renameZohoInvoice).not.toHaveBeenCalled();
    expect(mocks.assertZohoInvoiceNumberingReady).not.toHaveBeenCalled();
    expect(mocks.getZohoInvoice).toHaveBeenCalledTimes(1);
    expect(mocks.createZohoCustomerPayment).toHaveBeenCalledWith(expect.objectContaining({ invoiceId: "inv-1" }));
    const finalized = setCalls.find((values) => values.invoice_sync_state === "created");
    expect(finalized).toMatchObject({ zoho_invoice_id: "inv-1", zoho_invoice_number: "INV-900001" });
  });

  it("reuses the linked invoice on retry without reconverting or renumbering", async () => {
    setup({ quote: makeQuote(CANONICAL_HASH), remote: linkedRemote() });
    mocks.getZohoInvoice.mockResolvedValue(zohoInvoice());
    recordedPayment();

    await expect(ensureZohoInvoiceForOrder(ORDER_ID)).resolves.toBeUndefined();

    expect(mocks.convertZohoEstimateToInvoice).not.toHaveBeenCalled();
    expect(mocks.renameZohoInvoice).not.toHaveBeenCalled();
    const finalized = setCalls.find((values) => values.invoice_sync_state === "created");
    expect(finalized).toMatchObject({ zoho_invoice_id: "inv-1", zoho_invoice_number: "INV-900001" });
  });

  it("fails with the refusal code when Zoho rejects the conversion and no invoice links", async () => {
    setup({ quote: makeQuote(CANONICAL_HASH), remote: unlinkedRemote() });
    mocks.convertZohoEstimateToInvoice.mockRejectedValue(new ZohoEstimateConversionRejectedError(1002));

    vi.useFakeTimers();
    try {
      const pending = ensureZohoInvoiceForOrderUi(ORDER_ID);
      await vi.advanceTimersByTimeAsync(10_000);
      const result = await pending;

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("rejected the invoice conversion (code 1002)");
        expect(result.error).toContain("Zoho Books");
        expect(result.error).not.toContain("five minutes");
        expect(result.error).not.toContain("lost");
        expect(result.error).not.toContain("Some of the quotes");
      }
      expect(setCalls.some((values) => values.invoice_sync_state === "failed")).toBe(true);
      expect(setCalls.some((values) => values.invoice_sync_state === "uncertain")).toBe(false);
      expect(mocks.convertZohoEstimateToInvoice).toHaveBeenCalledTimes(1);
      expect(mocks.createZohoCustomerPayment).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("reconciles a bare-acknowledgement conversion through the estimate link", async () => {
    setup({ quote: makeQuote(CANONICAL_HASH), remote: linkedRemote() });
    mocks.getZohoEstimate.mockReset();
    mocks.getZohoEstimate.mockResolvedValueOnce(unlinkedRemote()).mockResolvedValue(linkedRemote());
    // The documented success shape: top-level code 0, no invoice object.
    mocks.convertZohoEstimateToInvoice.mockResolvedValue(null);
    mocks.getZohoInvoice.mockResolvedValue(zohoInvoice());
    recordedPayment();

    await expect(ensureZohoInvoiceForOrder(ORDER_ID)).resolves.toBeUndefined();

    expect(mocks.convertZohoEstimateToInvoice).toHaveBeenCalledTimes(1);
    expect(mocks.createZohoCustomerPayment).toHaveBeenCalled();
    const finalized = setCalls.find((values) => values.invoice_sync_state === "created");
    expect(finalized).toMatchObject({ zoho_invoice_id: "inv-1", zoho_invoice_number: "INV-900001" });
  });

  it("stays uncertain when an acknowledged conversion never links an invoice", async () => {
    setup({ quote: makeQuote(CANONICAL_HASH), remote: unlinkedRemote() });
    mocks.convertZohoEstimateToInvoice.mockResolvedValue(null);

    vi.useFakeTimers();
    try {
      const pending = ensureZohoInvoiceForOrderUi(ORDER_ID);
      await vi.advanceTimersByTimeAsync(10_000);
      const result = await pending;

      expect(result).toEqual({
        ok: false,
        error: "Zoho confirmed the quotation conversion but no invoice is linked to it yet. Wait five minutes, then check again; creation is locked meanwhile.",
      });
      expect(setCalls.some((values) => values.invoice_sync_state === "uncertain")).toBe(true);
      expect(mocks.convertZohoEstimateToInvoice).toHaveBeenCalledTimes(1);
      expect(mocks.createZohoCustomerPayment).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("reuses the linked invoice even when the conversion response was a refusal", async () => {
    setup({ quote: makeQuote(CANONICAL_HASH), remote: linkedRemote() });
    mocks.getZohoEstimate.mockReset();
    mocks.getZohoEstimate.mockResolvedValueOnce(unlinkedRemote()).mockResolvedValue(linkedRemote());
    mocks.convertZohoEstimateToInvoice.mockRejectedValue(new ZohoEstimateConversionRejectedError(1002));
    mocks.getZohoInvoice.mockResolvedValue(zohoInvoice());
    recordedPayment();

    await expect(ensureZohoInvoiceForOrder(ORDER_ID)).resolves.toBeUndefined();

    expect(mocks.convertZohoEstimateToInvoice).toHaveBeenCalledTimes(1);
    expect(mocks.createZohoCustomerPayment).toHaveBeenCalled();
  });

  it("keeps the lost-response uncertainty when the conversion errors and nothing links", async () => {
    setup({ quote: makeQuote(CANONICAL_HASH), remote: unlinkedRemote() });
    mocks.convertZohoEstimateToInvoice.mockRejectedValue(new Error("socket timeout"));

    vi.useFakeTimers();
    try {
      const pending = ensureZohoInvoiceForOrderUi(ORDER_ID);
      await vi.advanceTimersByTimeAsync(10_000);
      const result = await pending;

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("response was lost");
        expect(result.error).toContain("five minutes");
      }
      expect(setCalls.some((values) => values.invoice_sync_state === "uncertain")).toBe(true);
      expect(setCalls.some((values) => values.invoice_sync_state === "failed")).toBe(false);
      expect(mocks.convertZohoEstimateToInvoice).toHaveBeenCalledTimes(1);
      expect(mocks.createZohoCustomerPayment).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stays uncertain when the post-conversion link check itself fails", async () => {
    setup({ quote: makeQuote(CANONICAL_HASH), remote: unlinkedRemote() });
    mocks.getZohoEstimate.mockReset();
    mocks.getZohoEstimate
      .mockResolvedValueOnce(unlinkedRemote())
      .mockRejectedValue(new Error("RAW-SECRET-503 oauth_token=abc123"));
    mocks.convertZohoEstimateToInvoice.mockRejectedValue(new ZohoEstimateConversionRejectedError(1002));

    const result = await ensureZohoInvoiceForOrderUi(ORDER_ID);

    expect(result).toEqual({
      ok: false,
      error: "The Zoho invoice and deposit could not be recorded. Refresh the order and try again.",
    });
    expect(setCalls.some((values) => values.invoice_sync_state === "uncertain")).toBe(true);
    expect(setCalls.some((values) => values.invoice_sync_state === "failed")).toBe(false);
  });
});

describe("deposit payment raw-error sanitization", () => {
  it("reports the uncertainty guidance without leaking the raw SDK error", async () => {
    // Remote already links the invoice so the flow reaches the payment stage.
    setup({ quote: makeQuote(CANONICAL_HASH), remote: makeRemote({ invoice_ids: ["inv-1"] }) });
    mocks.getZohoInvoice.mockResolvedValue({
      invoice_id: "inv-1",
      invoice_number: "INV-677816",
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

// Shared fixtures for the import + confirm-sent flows. The order sits at
// order_recorded behind an unlinked local_draft quotation — the exact state the
// "Use existing Zoho quotation" action operates on.
const QUOTE_FLOW_ORDER = {
  id: ORDER_ID,
  display_id: "DW-1",
  order_reference: "DW-1",
  current_status: "order_recorded",
  consultant_id: "consult-1",
  customer_id: "cust-1",
  customer_name: "Jamie Tan",
  customer_email: null,
  customer_mobile: null,
  consultant_name: "Kenny",
};
const QUOTE_FLOW_LOCKED_ORDER = { current_status: "order_recorded", lead_id: "lead-1", appointment_id: null };
const QUOTE_FLOW_LEAD = { funnel_stage: "Send Quotation" };

function quoteFlowDraftRow() {
  return {
    id: QUOTE_ID,
    order_id: ORDER_ID,
    status: "local_draft",
    crm_quote_key: "dw:o-1:v1:q-1",
    issue_date: "2026-09-01",
    expiry_date: "2026-09-08",
    lines: LINES,
    quoted_total_cents: 201_000,
    customer_message: "local draft",
    zoho_estimate_id: null,
    updated_at: new Date("2026-09-19T00:00:00Z"),
  };
}

function quoteFlowZohoDraftRow(expiryDate: string | null) {
  return {
    ...quoteFlowDraftRow(),
    status: "zoho_draft",
    issue_date: "2026-09-19",
    expiry_date: expiryDate,
    zoho_estimate_id: "est-1",
    zoho_estimate_number: "QT-677815",
    zoho_last_modified_time: null,
    synced_payload_hash: "hash",
    pdf_storage_path: "quotes/o/q/h.pdf",
    pdf_sha256: "sha",
  };
}

// quotationReads feeds db.selectFrom("order_quotations") in call order: the
// import reads the draft, then the already-linked check (undefined), then
// confirmQuotationSent re-reads the just-imported row.
function setupQuoteFlow({ quotationReads, remote }: { quotationReads: unknown[]; remote: ReturnType<typeof makeRemote> }) {
  const dbResults: Record<string, unknown[]> = {
    order_quotations: [...quotationReads],
    orders: [QUOTE_FLOW_ORDER, QUOTE_FLOW_ORDER],
    customer_zoho_links: [{ zoho_contact_id: "contact-1" }],
  };
  mocks.selectFrom.mockImplementation((table: string) => builder(dbResults[table]?.shift()));
  const trxResults: Record<string, unknown[]> = {
    orders: [QUOTE_FLOW_LOCKED_ORDER, QUOTE_FLOW_LOCKED_ORDER],
    leads: [QUOTE_FLOW_LEAD],
  };
  const trx = {
    selectFrom: (table: string) => builder(trxResults[table]?.shift()),
    updateTable: () => builder({ id: QUOTE_ID }),
    insertInto: () => builder({}),
  };
  mocks.transaction.mockReturnValue({ execute: async (cb: (tx: typeof trx) => unknown) => cb(trx) });
  mocks.updateTable.mockImplementation(() => builder({ id: QUOTE_ID }));
  mocks.getZohoEstimate.mockResolvedValue(remote);
  mocks.findZohoEstimateByNumber.mockResolvedValue([{ estimate_id: "est-1" }]);
  mocks.getZohoEstimatePdf.mockResolvedValue(new Uint8Array([1, 2, 3]));
  mocks.adminClient.mockReturnValue({ storage: { from: () => ({ upload: async () => ({ error: null }) }) } });
  mocks.getZohoBooksBinding.mockResolvedValue({
    crmKeyFieldId: "cf-1",
    crmKeyApiName: "cf_crm_quote_key",
    estimateTemplateId: "tmpl-1",
  });
}

const importInput = { quotationId: QUOTE_ID, estimateNumber: "QT-677815", channel: "WhatsApp", note: "Imported existing Zoho quotation" };

describe("importExistingZohoQuotation with an optional expiry", () => {
  it("imports a Zoho quotation whose expiry is blank and stores a null expiry", async () => {
    setupQuoteFlow({
      quotationReads: [quoteFlowDraftRow(), undefined, quoteFlowZohoDraftRow(null)],
      remote: makeRemote({ estimate_number: "QT-677815", date: "2026-09-19", expiry_date: "" }),
    });

    const result = await importExistingZohoQuotation(importInput);

    expect(result).toEqual({ ok: true });
    const stored = setCalls.find((values) => "customer_message" in values);
    expect(stored).toMatchObject({ status: "zoho_draft", issue_date: "2026-09-19", expiry_date: null, zoho_estimate_id: "est-1" });
    expect(String(stored?.customer_message)).toContain("QT-677815");
    expect(String(stored?.customer_message)).not.toContain("valid until");
    // The import continues into confirm-sent, and the lead milestone update
    // leaves quote_valid_days untouched while the expiry is null.
    expect(setCalls.some((values) => values.status === "sent")).toBe(true);
    const leadUpdate = setCalls.find((values) => "funnel_stage" in values);
    expect(leadUpdate).toMatchObject({ funnel_stage: "Decision Pending", last_outcome: "Quotation Sent", latest_quote_cents: 201_000 });
    expect(leadUpdate).toHaveProperty("quotation_sent_at");
    expect(leadUpdate).toHaveProperty("quotation_breakdown");
    expect(leadUpdate).not.toHaveProperty("quote_valid_days");
  });

  it("stores the remote expiry unchanged when Zoho provides one", async () => {
    setupQuoteFlow({
      quotationReads: [quoteFlowDraftRow(), undefined, quoteFlowZohoDraftRow("2026-09-25")],
      remote: makeRemote({ estimate_number: "QT-677815", date: "2026-09-19", expiry_date: "2026-09-25" }),
    });

    const result = await importExistingZohoQuotation(importInput);

    expect(result).toEqual({ ok: true });
    const stored = setCalls.find((values) => "customer_message" in values);
    expect(stored).toMatchObject({ expiry_date: "2026-09-25" });
    expect(String(stored?.customer_message)).toContain("valid until 2026-09-25");
  });

  it.each([
    ["an expiry before the issue date", { date: "2026-09-19", expiry_date: "2026-09-10" }],
    ["a missing issue date", { date: "", expiry_date: "2026-09-25" }],
  ])("rejects %s", async (_case, patch) => {
    setupQuoteFlow({
      quotationReads: [quoteFlowDraftRow(), undefined, quoteFlowZohoDraftRow(null)],
      remote: makeRemote({ estimate_number: "QT-677815", ...patch }),
    });

    const result = await importExistingZohoQuotation(importInput);

    expect(result).toEqual({ ok: false, error: "The Zoho quotation dates are incomplete" });
    expect(setCalls).toHaveLength(0);
  });
});

describe("createQuotationRevision", () => {
  // The source read, the authorizedOrder lookup and the status re-check hit
  // the same two tables; inside the transaction the forUpdate reads return
  // the same rows again.
  function setupRevision(source: Record<string, unknown>) {
    const order = {
      id: ORDER_ID,
      display_id: "DW-1",
      order_reference: "DW-1",
      current_status: "quotation_sent",
      consultant_id: "consult-1",
      customer_id: "cust-1",
      customer_name: "Jamie Tan",
      customer_email: null,
      customer_mobile: null,
      consultant_name: "Kenny",
    };
    mocks.selectFrom.mockImplementation((table: string) =>
      builder(table === "order_quotations" ? source : table === "orders" ? order : undefined));
    const trx = {
      selectFrom: (table: string) =>
        builder(table === "orders" ? { current_status: "quotation_sent" } : table === "order_quotations" ? source : undefined),
      updateTable: () => builder({ id: QUOTE_ID }),
      insertInto: () => builder({}),
    };
    mocks.transaction.mockReturnValue({ execute: async (cb: (tx: typeof trx) => unknown) => cb(trx) });
  }

  const sentQuote = () => ({ ...makeQuote(CANONICAL_HASH), revision: 1, customer_message: "sent message" });

  it("serializes the locked jsonb lines into the revision insert", async () => {
    setupRevision(sentQuote());

    const result = await createQuotationRevision(QUOTE_ID);

    expect(result).toEqual({ id: expect.any(String) });
    const inserted = insertCalls.find((values) => "crm_quote_key" in values);
    expect(inserted).toMatchObject({ order_id: ORDER_ID, revision: 2, status: "local_draft" });
    // locked.lines arrives from node-postgres as a JS array; the jsonb column
    // needs serialized JSON text, not a Postgres array literal.
    expect(inserted?.lines).toBe(JSON.stringify(LINES));
  });

  it("supersedes the source quotation inside the same transaction", async () => {
    setupRevision(sentQuote());

    await createQuotationRevision(QUOTE_ID);

    const superseded = setCalls.find((values) => values.status === "superseded");
    expect(superseded).toBeTruthy();
    expect(superseded).toHaveProperty("superseded_at");
  });

  it("rejects a source that is not sent and inserts nothing", async () => {
    setupRevision({ ...sentQuote(), status: "local_draft" });

    await expect(createQuotationRevision(QUOTE_ID)).rejects.toThrow("Only a sent quotation needs a revision");
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(insertCalls).toHaveLength(0);
  });
});

describe("confirmQuotationSent quote_valid_days", () => {
  it("computes quote_valid_days from the expiry when one is set", async () => {
    setupQuoteFlow({ quotationReads: [quoteFlowZohoDraftRow("2026-09-26")], remote: makeRemote() });

    await confirmQuotationSent({ quotationId: QUOTE_ID, channel: "WhatsApp", note: "" });

    const leadUpdate = setCalls.find((values) => "funnel_stage" in values);
    expect(leadUpdate).toMatchObject({ funnel_stage: "Decision Pending", last_outcome: "Quotation Sent", quote_valid_days: 7 });
  });

  it("omits quote_valid_days from the lead update when the quotation has no expiry", async () => {
    setupQuoteFlow({ quotationReads: [quoteFlowZohoDraftRow(null)], remote: makeRemote() });

    await confirmQuotationSent({ quotationId: QUOTE_ID, channel: "WhatsApp", note: "" });

    const leadUpdate = setCalls.find((values) => "funnel_stage" in values);
    expect(leadUpdate).toBeTruthy();
    expect(leadUpdate).not.toHaveProperty("quote_valid_days");
  });
});

describe("saveQuotation on a sent quotation", () => {
  const saveInput = (quotationId: string, updatedAt: string) => ({
    orderId: ORDER_ID, quotationId, expectedUpdatedAt: updatedAt, issueDate: "2026-09-24", expiryDate: null,
    lines: LINES, customerMessage: "", notes: "", terms: "",
  });

  function setupSave(orderStatus: string, current: Record<string, unknown>) {
    const order = { id: ORDER_ID, display_id: "DW-1", order_reference: "DW-1", current_status: orderStatus, consultant_id: "consult-1", customer_id: "cust-1", customer_name: "Jamie Tan", customer_email: null, customer_mobile: null, consultant_name: "Kenny" };
    mocks.selectFrom.mockImplementation((table: string) => builder(table === "orders" ? order : undefined));
    const trx = {
      selectFrom: (table: string) => builder(table === "order_quotations" ? current : undefined),
      updateTable: () => builder({ id: QUOTE_ID }),
      insertInto: () => builder({}),
    };
    mocks.transaction.mockReturnValue({ execute: async (cb: (tx: typeof trx) => unknown) => cb(trx) });
  }

  it("moves a sent quotation back to local_draft and keeps its sent fields", async () => {
    const updatedAt = new Date("2026-09-22T04:03:36.347Z");
    setupSave("quotation_sent", { ...makeQuote(CANONICAL_HASH), status: "sent", sent_at: updatedAt, updated_at: updatedAt });

    await saveQuotation(saveInput(QUOTE_ID, updatedAt.toISOString()));

    const saved = setCalls.find((values) => values.status === "local_draft");
    expect(saved).toBeTruthy();
    expect(saved?.lines).toBe(JSON.stringify(LINES));
    expect(saved).not.toHaveProperty("sent_at");
    expect(saved).not.toHaveProperty("sent_by");
  });

  it("refuses once the deposit is recorded", async () => {
    setupSave("deposit_received", { ...makeQuote(CANONICAL_HASH), status: "sent" });
    await expect(saveQuotation(saveInput(QUOTE_ID, new Date().toISOString())))
      .rejects.toThrow("This quotation is final — the deposit has been recorded");
  });

  it("refuses a quotation that already has a Zoho invoice while the order is still quotation_sent", async () => {
    // DW-2026-0043 deadlock: conversion wrote zoho_invoice_id, renumbering
    // failed, the order stayed quotation_sent — the quote must still be final.
    const updatedAt = new Date("2026-09-22T04:03:36.347Z");
    setupSave("quotation_sent", { ...makeQuote(CANONICAL_HASH), status: "sync_failed", zoho_invoice_id: "inv-1", updated_at: updatedAt });

    await expect(saveQuotation(saveInput(QUOTE_ID, updatedAt.toISOString())))
      .rejects.toThrow(QUOTATION_INVOICED_MESSAGE);

    expect(setCalls.find((values) => values.status === "local_draft")).toBeUndefined();
  });
});

describe("syncQuotation for a previously-sent quotation", () => {
  const SENT_AT = new Date("2026-09-22T04:03:36.347Z");
  const UPDATED_AT = new Date("2026-09-24T02:00:00.000Z");
  const EDITED_LINES = [{ ...LINES[0], rateCents: 50000 }];

  function editedSentRow(overrides: Record<string, unknown> = {}) {
    return {
      ...makeQuote(CANONICAL_HASH), status: "local_draft", sent_at: SENT_AT, sent_by: "consult-1", sent_channel: "WhatsApp",
      zoho_estimate_id: "est-1", zoho_estimate_number: "QT-677819", zoho_last_modified_time: "t1",
      lines: EDITED_LINES, quoted_total_cents: 50000, updated_at: UPDATED_AT, ...overrides,
    };
  }

  function setupSync(row: Record<string, unknown>, remoteBefore: Record<string, unknown>, remoteAfter: Record<string, unknown>[]) {
    const order = { id: ORDER_ID, display_id: "DW-1", order_reference: "DW-1", current_status: "quotation_sent", consultant_id: "consult-1", customer_id: "cust-1", customer_name: "Jamie Tan", customer_email: null, customer_mobile: null, consultant_name: "Kenny", lead_id: "lead-1", appointment_id: null };
    const tables: Record<string, unknown[]> = {
      order_quotations: [row],
      orders: [order],
      customer_zoho_links: [{ zoho_contact_id: "contact-1" }],
    };
    mocks.selectFrom.mockImplementation((table: string) => builder(tables[table]?.shift()));
    mocks.updateTable.mockImplementation(() => builder({ ...row, status: "syncing" }));
    const trx = {
      selectFrom: (table: string) => builder(
        table === "orders" ? order
          : table === "order_quotation_versions" ? { max_version: 1 }
          : table === "leads" ? { id: "lead-1" }
          : undefined),
      updateTable: () => builder({ id: QUOTE_ID }),
      insertInto: () => builder({}),
    };
    mocks.transaction.mockReturnValue({ execute: async (cb: (tx: typeof trx) => unknown) => cb(trx) });
    mocks.getZohoEstimate.mockResolvedValueOnce(remoteBefore);
    for (const remote of remoteAfter) mocks.getZohoEstimate.mockResolvedValueOnce(remote);
    mocks.syncZohoEstimate.mockResolvedValue({ estimate_id: "est-1", estimate_number: "QT-677819" });
    mocks.getZohoEstimatePdf.mockResolvedValue(new Uint8Array([37, 80, 68, 70, 45]));
    mocks.adminClient.mockReturnValue({ storage: { from: () => ({ upload: async () => ({ error: null }) }) } });
    mocks.getZohoBooksBinding.mockResolvedValue({ crmKeyFieldId: "cf-1", crmKeyApiName: "cf_crm_quote_key", estimateTemplateId: "tmpl-1" });
  }

  // makeRemote(...) builds a Zoho estimate matching the CRM row; pass the
  // edited lines so the post-sync snapshot and total match.
  const remoteFor = (status: string, lines = EDITED_LINES, modified = "t1") =>
    makeRemote({ status, last_modified_time: modified, total: lines.reduce((sum, line) => sum + line.rateCents * line.quantity, 0) / 100, line_items: lines.map((line) => ({ item_id: line.zohoItemId ?? undefined, name: line.name, description: line.description, quantity: line.quantity, rate: line.rateCents / 100, discount: line.discountPercent })) });

  it("updates the same Zoho estimate, returns to sent and writes a version snapshot", async () => {
    setupSync(editedSentRow(), remoteFor("sent", LINES), [remoteFor("sent", EDITED_LINES, "t2")]);

    await syncQuotation(QUOTE_ID);

    expect(mocks.syncZohoEstimate).toHaveBeenCalledWith(expect.objectContaining({ estimateId: "est-1" }));
    expect(setCalls.find((values) => values.status === "sent")).toMatchObject({ zoho_estimate_number: "QT-677819", zoho_last_modified_time: "t2" });
    const version = insertCalls.find((values) => "version" in values);
    expect(version).toMatchObject({ quotation_id: QUOTE_ID, version: 2, quoted_total_cents: 50000 });
    expect(version?.lines).toBe(JSON.stringify(EDITED_LINES));
    expect(setCalls.find((values) => "price_quoted_cents" in values)).toMatchObject({ price_quoted_cents: 50000 });
    expect(setCalls.find((values) => "latest_quote_cents" in values)).toMatchObject({ latest_quote_cents: 50000 });
  });

  it("re-marks the estimate sent when Zoho reverted it to draft on edit", async () => {
    setupSync(editedSentRow(), remoteFor("sent", LINES), [remoteFor("draft", EDITED_LINES, "t2"), remoteFor("sent", EDITED_LINES, "t3")]);

    await syncQuotation(QUOTE_ID);

    expect(mocks.markZohoEstimateSent).toHaveBeenCalledWith("est-1");
    expect(setCalls.find((values) => values.status === "sent")).toMatchObject({ zoho_last_modified_time: "t3" });
  });

  it("refuses an invoiced estimate without entering conflict", async () => {
    setupSync(editedSentRow(), { ...remoteFor("invoiced", LINES), invoice_ids: ["inv-1"] }, []);

    await expect(syncQuotation(QUOTE_ID)).rejects.toThrow("already been invoiced");
    expect(mocks.syncZohoEstimate).not.toHaveBeenCalled();
    expect(setCalls.find((values) => values.status === "sync_failed")).toBeTruthy();
    expect(setCalls.find((values) => values.status === "conflict")).toBeUndefined();
  });

  it("refuses a quotation that already has a Zoho invoice before claiming or touching Zoho", async () => {
    setupSync(editedSentRow({ status: "sync_failed", zoho_invoice_id: "inv-1" }), remoteFor("sent", LINES), []);
    // setupSync queues a remote the action must never read; drop it so the
    // once-queue stays clean for the next test.
    mocks.getZohoEstimate.mockReset();

    await expect(syncQuotation(QUOTE_ID)).rejects.toThrow(QUOTATION_INVOICED_MESSAGE);

    expect(mocks.getZohoEstimate).not.toHaveBeenCalled();
    expect(mocks.syncZohoEstimate).not.toHaveBeenCalled();
    expect(setCalls.find((values) => "status" in values)).toBeUndefined();
  });

  it("does not treat a status-only timestamp change as drift", async () => {
    // Stored hash equals the remote snapshot (content unchanged), timestamp moved by mark-sent.
    const remote = remoteFor("sent", LINES, "t9");
    setupSync(editedSentRow({ synced_payload_hash: estimateSnapshotHash(remote as Record<string, unknown>) }), remote, [remoteFor("sent", EDITED_LINES, "t10")]);

    await syncQuotation(QUOTE_ID);

    expect(setCalls.find((values) => values.status === "conflict")).toBeUndefined();
    expect(setCalls.find((values) => values.status === "sent")).toBeTruthy();
  });

  it("syncs a previously-sent quotation whose remote never had a CRM Quote Key", async () => {
    // An estimate brought in via "Use existing Zoho quote" carries no CRM
    // Quote Key until a successful sync stamps it; the absence must not
    // conflict.
    setupSync(
      editedSentRow(),
      { ...remoteFor("sent", LINES), custom_fields: [] },
      [{ ...remoteFor("sent", EDITED_LINES, "t2"), custom_fields: [] }],
    );

    await syncQuotation(QUOTE_ID);

    expect(setCalls.find((values) => values.status === "sent")).toBeTruthy();
    expect(setCalls.find((values) => values.status === "conflict")).toBeUndefined();
  });

  it("still refuses a remote carrying a different CRM Quote Key", async () => {
    setupSync(
      editedSentRow(),
      { ...remoteFor("sent", LINES), custom_fields: [{ label: "CRM Quote Key", value: "dw:other:v1:q-9" }] },
      [],
    );

    await expect(syncQuotation(QUOTE_ID)).rejects.toThrow("The Zoho CRM Quote Key changed");

    expect(mocks.syncZohoEstimate).not.toHaveBeenCalled();
    expect(setCalls.find((values) => values.status === "conflict")).toBeTruthy();
  });

  it("refuses the legacy one-way reconcile and points at the review dialog", async () => {
    setupSync(
      { ...editedSentRow(), status: "conflict" },
      makeRemote({ status: "sent", last_modified_time: "t5", custom_fields: [] }),
      [],
    );

    await expect(acknowledgeZohoConflict(QUOTE_ID)).rejects.toThrow("Review Zoho details");

    expect(setCalls).toHaveLength(0);
    expect(mocks.getZohoEstimate).not.toHaveBeenCalled();
  });

  it("accepts an already-sent remote for a never-sent quotation and stays zoho_draft", async () => {
    // A failed confirm-sent can leave Zoho "sent" while the CRM row still has
    // sent_at = null. Re-syncing must accept that remote instead of deadlocking
    // the quotation on the draft-only status check.
    const row = { ...makeQuote(CANONICAL_HASH), status: "local_draft", sent_at: null, zoho_estimate_id: "est-1", zoho_last_modified_time: "t1", updated_at: UPDATED_AT };
    setupSync(row, makeRemote({ status: "sent", last_modified_time: "t1" }), [makeRemote({ status: "sent", last_modified_time: "t2" })]);

    await syncQuotation(QUOTE_ID);

    expect(setCalls.find((values) => values.status === "zoho_draft")).toBeTruthy();
    expect(setCalls.find((values) => values.status === "sent")).toBeUndefined();
    expect(mocks.markZohoEstimateSent).not.toHaveBeenCalled();
    expect(insertCalls.find((values) => "version" in values)).toBeUndefined();
  });

  it("syncs a never-sent quotation even when another Zoho invoice holds the matching number", async () => {
    // Zoho Books owns invoice numbering; an unrelated invoice holding the
    // quotation's suffix no longer gates the send.
    const row = { ...makeQuote(CANONICAL_HASH), status: "local_draft", sent_at: null, zoho_estimate_id: "est-1", zoho_last_modified_time: "t1", updated_at: UPDATED_AT };
    setupSync(row, makeRemote({ status: "sent", last_modified_time: "t1" }), [makeRemote({ status: "sent", last_modified_time: "t2" })]);
    mocks.findZohoInvoicesByNumber.mockResolvedValue([{ invoice_id: "other", invoice_number: "INV-677819" }]);

    await syncQuotation(QUOTE_ID);

    expect(mocks.findZohoInvoicesByNumber).not.toHaveBeenCalled();
    expect(setCalls.find((values) => values.status === "zoho_draft")).toBeTruthy();
    expect(setCalls.find((values) => values.status === "sync_failed")).toBeUndefined();
    expect(setCalls.find((values) => values.status === "conflict")).toBeUndefined();
  });
});

describe("confirmQuotationSent first send", () => {
  it("refuses a quotation that was already sent", async () => {
    setupQuoteFlow({ quotationReads: [{ ...quoteFlowZohoDraftRow(null), sent_at: new Date() }], remote: makeRemote() });
    await expect(confirmQuotationSent({ quotationId: QUOTE_ID, channel: "WhatsApp", note: "" }))
      .rejects.toThrow("already been sent");
  });

  it("stores Zoho's post-send timestamp and writes version 1", async () => {
    setupQuoteFlow({ quotationReads: [quoteFlowZohoDraftRow(null)], remote: makeRemote({ status: "draft" }) });
    mocks.getZohoEstimate.mockReset();
    mocks.getZohoEstimate.mockResolvedValueOnce(makeRemote({ status: "draft" })).mockResolvedValueOnce(makeRemote({ status: "sent", last_modified_time: "after-send" }));

    await confirmQuotationSent({ quotationId: QUOTE_ID, channel: "WhatsApp", note: "" });

    expect(setCalls.find((values) => values.status === "sent")).toMatchObject({ zoho_last_modified_time: "after-send" });
    expect(insertCalls.find((values) => "version" in values)).toMatchObject({ quotation_id: QUOTE_ID, version: 1 });
  });
});

describe("invoice numbers owned by Zoho before the quote goes to the customer", () => {
  it("confirmQuotationSent proceeds even when another Zoho invoice holds the matching number", async () => {
    setupQuoteFlow({ quotationReads: [quoteFlowZohoDraftRow(null)], remote: makeRemote({ status: "draft" }) });
    mocks.findZohoInvoicesByNumber.mockResolvedValue([{ invoice_id: "other", invoice_number: "INV-677815" }]);
    mocks.getZohoEstimate.mockReset();
    mocks.getZohoEstimate.mockResolvedValueOnce(makeRemote({ status: "draft" })).mockResolvedValueOnce(makeRemote({ status: "sent", last_modified_time: "after-send" }));

    await confirmQuotationSent({ quotationId: QUOTE_ID, channel: "WhatsApp", note: "" });

    expect(mocks.findZohoInvoicesByNumber).not.toHaveBeenCalled();
    expect(setCalls.find((values) => values.status === "sent")).toBeTruthy();
  });
});

describe("reconcile and deposit with editable quotations", () => {
  it("does not overwrite Zoho from the deprecated acknowledge action", async () => {
    const row = { ...makeQuote(CANONICAL_HASH), status: "conflict", zoho_estimate_id: "est-1", sent_at: new Date(), updated_at: new Date() };
    const order = { id: ORDER_ID, display_id: "DW-1", order_reference: "DW-1", current_status: "quotation_sent", consultant_id: "consult-1", customer_id: "cust-1", customer_name: "Jamie Tan", customer_email: null, customer_mobile: null, consultant_name: "Kenny" };
    mocks.selectFrom.mockImplementation((table: string) => builder(table === "order_quotations" ? row : table === "orders" ? order : undefined));

    await expect(acknowledgeZohoConflict(QUOTE_ID)).rejects.toThrow("Review Zoho details");

    expect(setCalls).toHaveLength(0);
    expect(mocks.syncZohoEstimate).not.toHaveBeenCalled();
  });

  it("asks to sync unsynced edits before the deposit", async () => {
    // Reuse setup(...) from the ensureZohoInvoiceForOrder tests with a previously-sent local_draft quote.
    setup({ quote: { ...makeQuote(CANONICAL_HASH), status: "local_draft", sent_at: new Date() }, remote: makeRemote() });
    await expect(ensureZohoInvoiceForOrder(ORDER_ID)).rejects.toThrow("Sync the latest quotation changes to Zoho before recording the deposit");
  });
});

// Review-and-apply flow: the comparison preview binds an apply call to the
// exact CRM revision and remote snapshot the reviewer saw.
const REVIEW_ORDER = {
  id: ORDER_ID,
  display_id: "DW-1",
  order_reference: "DW-1",
  current_status: "quotation_sent",
  consultant_id: "consult-1",
  customer_id: "cust-1",
  customer_name: "Jamie Tan",
  customer_email: null,
  customer_mobile: null,
  consultant_name: "Kenny",
};
const REVIEW_LOCKED_ORDER = { current_status: "quotation_sent", lead_id: "lead-1", appointment_id: null };

function reviewRow(patch: Record<string, unknown> = {}) {
  return {
    ...makeQuote(CANONICAL_HASH),
    status: "conflict",
    sent_at: null,
    sent_by: null,
    sent_channel: null,
    customer_message: "local draft",
    zoho_estimate_id: "est-1",
    zoho_estimate_number: "QT-677816",
    zoho_last_modified_time: "t9",
    updated_at: new Date("2026-10-01T00:00:00Z"),
    ...patch,
  };
}

// A remote with explicit percentage discounts: 2 × S$450 − 10% = S$810.
function reviewRemote(patch: Record<string, unknown> = {}) {
  return makeRemote({
    date: "2026-10-05",
    expiry_date: "2026-10-12",
    notes: "remote notes",
    terms: "remote terms",
    total: 810,
    last_modified_time: "t9",
    line_items: [{ item_id: "item-9", name: "Sheer", description: "day", quantity: 2, rate: 450, discount: "10%" }],
    ...patch,
  });
}

function setupReview(row: Record<string, unknown>, remote: Record<string, unknown>) {
  const dbResults: Record<string, unknown[]> = {
    order_quotations: [row],
    orders: [REVIEW_ORDER],
    customer_zoho_links: [{ zoho_contact_id: "contact-1" }],
  };
  mocks.selectFrom.mockImplementation((table: string) => builder(dbResults[table]?.shift()));
  const trxResults: Record<string, unknown[]> = {
    orders: [REVIEW_LOCKED_ORDER, REVIEW_LOCKED_ORDER, REVIEW_LOCKED_ORDER],
    order_quotation_versions: [{ max_version: 1 }],
    leads: [{ id: "lead-1", funnel_stage: "Decision Pending" }],
  };
  const trx = {
    selectFrom: (table: string) => builder(trxResults[table]?.shift()),
    updateTable: () => builder({ id: QUOTE_ID }),
    insertInto: () => builder({}),
  };
  mocks.transaction.mockReturnValue({ execute: async (cb: (tx: typeof trx) => unknown) => cb(trx) });
  mocks.updateTable.mockImplementation(() => builder({ id: QUOTE_ID }));
  mocks.getZohoEstimate.mockResolvedValue(remote);
  mocks.getZohoEstimatePdf.mockResolvedValue(new Uint8Array([37, 80, 68, 70, 45]));
  mocks.adminClient.mockReturnValue({ storage: { from: () => ({ upload: async () => ({ error: null }) }) } });
  mocks.getZohoBooksBinding.mockResolvedValue({ crmKeyFieldId: "cf-1", crmKeyApiName: "cf_crm_quote_key", estimateTemplateId: "tmpl-1" });
}

function reviewInput(row: Record<string, unknown>, remote: Record<string, unknown>) {
  return {
    quotationId: QUOTE_ID,
    expectedUpdatedAt: new Date(row.updated_at as Date).toISOString(),
    remoteFingerprint: zohoAdoptionFingerprint(remote as Record<string, unknown>),
  };
}

describe("previewQuotationZohoDiff", () => {
  it("returns both sides, the binding fingerprints and adopt issues", async () => {
    const row = reviewRow();
    const remote = reviewRemote();
    setupReview(row, remote);

    const preview = await previewQuotationZohoDiff(QUOTE_ID);

    expect(preview.quotationId).toBe(QUOTE_ID);
    expect(preview.crmRevision).toBe(new Date("2026-10-01T00:00:00Z").toISOString());
    expect(preview.remoteFingerprint).toBe(zohoAdoptionFingerprint(remote as Record<string, unknown>));
    expect(preview.crm).toMatchObject({ totalCents: 201_000, previouslySent: false, issueDate: "2026-09-10" });
    expect(preview.zoho).toMatchObject({ estimateNumber: "QT-677812", totalCents: 81_000, issueDate: "2026-10-05" });
    expect(preview.identical).toBe(false);
    expect(preview.adoptIssues).toEqual([]);
  });

  it("shows a readable comparison with actions blocked during a pending invoice operation", async () => {
    setupReview(reviewRow({ invoice_sync_state: "pending" }), reviewRemote());
    const preview = await previewQuotationZohoDiff(QUOTE_ID);
    expect(preview.overwriteBlockedReason).toContain("still in progress");
    expect(preview.adoptIssues.join(" ")).toContain("still in progress");
  });

  it("reports identical only when every compared field actually matches", async () => {
    const row = reviewRow();
    // Same content as the saved CRM draft, expressed the way Zoho echoes it.
    const remote = reviewRemote({
      date: "2026-09-10", expiry_date: "2026-09-17", notes: "leave with maid", terms: "50% deposit", total: 2010,
      line_items: [
        { name: "Curtains and blinds", description: "", quantity: 1, rate: 1200, discount: "0%" },
        { item_id: "item-9", name: "Sheer", description: "day curtain", quantity: 2, rate: 450, discount: "10%" },
      ],
    });
    setupReview(row, remote);

    const preview = await previewQuotationZohoDiff(QUOTE_ID);
    expect(preview.identical).toBe(true);
    expect(preview.warnings).toEqual([]);
  });

  it("does not claim a match when a catalog item was renamed on the same item_id", async () => {
    const row = reviewRow();
    const remote = reviewRemote({
      date: "2026-09-10", expiry_date: "2026-09-17", notes: "leave with maid", terms: "50% deposit", total: 2010,
      line_items: [
        { name: "Curtains and blinds", description: "", quantity: 1, rate: 1200, discount: "0%" },
        { item_id: "item-9", name: "Renamed sheer", description: "day curtain", quantity: 2, rate: 450, discount: "10%" },
      ],
    });
    setupReview(row, remote);

    const preview = await previewQuotationZohoDiff(QUOTE_ID);
    expect(preview.identical).toBe(false);
  });

  it("warns when a previously-sent quotation's Zoho copy is not in a sent state", async () => {
    const row = reviewRow({ sent_at: new Date("2026-09-20T00:00:00Z") });
    setupReview(row, reviewRemote({ status: "draft" }));

    const preview = await previewQuotationZohoDiff(QUOTE_ID);
    expect(preview.warnings).toHaveLength(1);
    expect(preview.warnings[0]).toContain("draft");
    expect(preview.warnings[0]).toContain("sent or accepted");
  });
});

describe("adoptZohoQuotation", () => {
  it("adopts the remote document into the same row without any Zoho write", async () => {
    const row = reviewRow();
    const remote = reviewRemote();
    setupReview(row, remote);

    await adoptZohoQuotation(reviewInput(row, remote));

    expect(mocks.syncZohoEstimate).not.toHaveBeenCalled();
    expect(mocks.markZohoEstimateSent).not.toHaveBeenCalled();
    const adopted = setCalls.find((values) => values.status === "zoho_draft");
    expect(adopted).toMatchObject({
      issue_date: "2026-10-05",
      expiry_date: "2026-10-12",
      quoted_total_cents: 81_000,
      notes: "remote notes",
      terms: "remote terms",
      zoho_estimate_number: "QT-677812",
      zoho_status: "sent",
      synced_payload_hash: estimateSnapshotHash(remote as Record<string, unknown>),
    });
    // Sent attribution is preserved: never written, never cleared.
    expect(adopted).not.toHaveProperty("sent_at");
    expect(adopted).not.toHaveProperty("sent_by");
    // The choice is recorded on the order timeline at the unchanged status.
    const audit = insertCalls.find((values) => "note" in values);
    expect(audit).toMatchObject({ order_id: ORDER_ID, status: "quotation_sent", created_by: "ops-user" });
    expect(String(audit?.note)).toContain("used the Zoho details");
    // A plain (non-generated) message is preserved verbatim.
    expect(adopted?.customer_message).toBe("local draft");
    // The unsent quote is not marked sent — Confirm quotation sent is still required.
    expect(setCalls.find((values) => values.status === "sent")).toBeUndefined();
    expect(insertCalls.find((values) => "version" in values)).toBeUndefined();
  });

  it("refreshes a generated customer message when price and dates change", async () => {
    const row = reviewRow({
      customer_message: defaultCustomerMessage({ customerName: "Jamie Tan", displayId: "QT-677816", totalCents: 201_000, expiryDate: "2026-09-17" }),
    });
    const remote = reviewRemote();
    setupReview(row, remote);

    await adoptZohoQuotation(reviewInput(row, remote));

    const adopted = setCalls.find((values) => values.status === "zoho_draft");
    expect(String(adopted?.customer_message)).toContain("QT-677812");
    expect(String(adopted?.customer_message)).toContain("valid until 2026-10-12");
  });

  it("returns a previously-sent quotation to sent with a version snapshot and price propagation", async () => {
    const row = reviewRow({ sent_at: new Date("2026-09-20T00:00:00Z"), sent_by: "consult-1", sent_channel: "WhatsApp" });
    const remote = reviewRemote();
    setupReview(row, remote);

    await adoptZohoQuotation(reviewInput(row, remote));

    const adopted = setCalls.find((values) => values.status === "sent");
    expect(adopted).toBeTruthy();
    expect(adopted).not.toHaveProperty("sent_at");
    const version = insertCalls.find((values) => "version" in values);
    expect(version).toMatchObject({ quotation_id: QUOTE_ID, version: 2, quoted_total_cents: 81_000 });
    expect(setCalls.find((values) => "price_quoted_cents" in values)).toMatchObject({ price_quoted_cents: 81_000 });
    expect(setCalls.find((values) => "latest_quote_cents" in values)).toMatchObject({ latest_quote_cents: 81_000 });
  });

  it("rejects when Zoho moved since the preview and restores the prior status", async () => {
    const row = reviewRow();
    const remote = reviewRemote();
    setupReview(row, remote);

    await expect(adoptZohoQuotation({ ...reviewInput(row, remote), remoteFingerprint: "stale" }))
      .rejects.toThrow("changed since it was previewed");

    expect(mocks.getZohoEstimatePdf).not.toHaveBeenCalled();
    expect(setCalls.find((values) => values.status === "conflict" && "sync_error" in values)).toBeTruthy();
    expect(setCalls.find((values) => "lines" in values)).toBeUndefined();
  });

  it("rejects when the CRM row moved since the preview without claiming", async () => {
    const row = reviewRow();
    const remote = reviewRemote();
    setupReview(row, remote);

    await expect(adoptZohoQuotation({ ...reviewInput(row, remote), expectedUpdatedAt: new Date("2026-10-02T00:00:00Z").toISOString() }))
      .rejects.toThrow("changed since it was previewed");

    expect(setCalls).toHaveLength(0);
    expect(mocks.getZohoEstimate).not.toHaveBeenCalled();
  });

  it("rejects unsupported remote financial structures instead of reinterpreting them", async () => {
    const row = reviewRow();
    const remote = reviewRemote({ line_items: [{ name: "Sheer", quantity: 2, rate: 450, discount: 50 }] });
    setupReview(row, remote);

    await expect(adoptZohoQuotation(reviewInput(row, remote))).rejects.toThrow("cannot be adopted");

    expect(mocks.syncZohoEstimate).not.toHaveBeenCalled();
    expect(mocks.getZohoEstimatePdf).not.toHaveBeenCalled();
    expect(setCalls.find((values) => values.status === "conflict" && "sync_error" in values)).toBeTruthy();
  });

  it("refuses a duplicate apply when the claim was already taken", async () => {
    const row = reviewRow();
    const remote = reviewRemote();
    setupReview(row, remote);
    mocks.updateTable.mockImplementation(() => builder(undefined)); // racing apply won the claim

    await expect(adoptZohoQuotation(reviewInput(row, remote))).rejects.toThrow("already being processed");
    expect(mocks.getZohoEstimate).not.toHaveBeenCalled();
  });

  it("rejects a remote with no customer identity as unverified", async () => {
    const row = reviewRow();
    const remote = reviewRemote({ customer_id: null });
    setupReview(row, remote);

    await expect(adoptZohoQuotation(reviewInput(row, remote))).rejects.toThrow("different customer");
    expect(mocks.getZohoEstimatePdf).not.toHaveBeenCalled();
  });

  it("rejects lines the CRM schema cannot hold even when the remote parses", async () => {
    const row = reviewRow();
    const remote = reviewRemote({ line_items: [{ name: "Sheer", quantity: -2, rate: 450 }], total: -900 });
    setupReview(row, remote);

    await expect(adoptZohoQuotation(reviewInput(row, remote))).rejects.toThrow("cannot be represented");
    expect(setCalls.find((values) => "lines" in values)).toBeUndefined();
  });

  it("adopts an explicit percentage with Zoho's consistent derived amounts", async () => {
    const row = reviewRow();
    const remote = reviewRemote({
      total: 180,
      line_items: [{ item_id: "item-9", name: "Sheer", description: "day", quantity: 2, rate: 100, discount: "10%", discount_amount: 20, item_total: 180 }],
    });
    setupReview(row, remote);

    await adoptZohoQuotation(reviewInput(row, remote));

    const adopted = setCalls.find((values) => values.status === "zoho_draft");
    expect(adopted).toMatchObject({ quoted_total_cents: 18_000 });
    const lines = JSON.parse(String(adopted?.lines)) as Array<{ discountPercent: number }>;
    expect(lines[0].discountPercent).toBe(10);
  });

  it("adopts a draft remote onto a previously-sent row without touching Zoho or sent attribution", async () => {
    // Product behavior with explicit visibility: the CRM keeps its original
    // sent record, nothing is written or marked in Zoho, and the audit note
    // records the remote status the reviewer saw.
    const row = reviewRow({ sent_at: new Date("2026-09-20T00:00:00Z"), sent_by: "consult-1", sent_channel: "WhatsApp" });
    const remote = reviewRemote({ status: "draft" });
    setupReview(row, remote);

    await adoptZohoQuotation(reviewInput(row, remote));

    expect(mocks.syncZohoEstimate).not.toHaveBeenCalled();
    expect(mocks.markZohoEstimateSent).not.toHaveBeenCalled();
    const adopted = setCalls.find((values) => values.status === "sent");
    expect(adopted).toBeTruthy();
    expect(adopted).toMatchObject({ zoho_status: "draft" });
    expect(adopted).not.toHaveProperty("sent_at");
    const audit = insertCalls.find((values) => "note" in values);
    expect(String(audit?.note)).toContain("draft");
  });

  it("rejects a remote with a non-calendar date before any storage write", async () => {
    const row = reviewRow();
    const remote = reviewRemote({ date: "2026-02-30" });
    setupReview(row, remote);

    await expect(adoptZohoQuotation(reviewInput(row, remote))).rejects.toThrow("dates");
    expect(mocks.getZohoEstimatePdf).not.toHaveBeenCalled();
    expect(setCalls.find((values) => "issue_date" in values)).toBeUndefined();
  });
});

describe("overwriteZohoWithCrmQuotation", () => {
  // The reviewed overwrite claims the previewed row once, straight to
  // syncing: the guard reads the row/order/link, then syncQuotationInternal
  // reads them again as its seed. Remote fetches: guard check, pre-push
  // fingerprint, post-write verify, post-PDF check.
  function setupReviewedSync(row: Record<string, unknown>, remote: Record<string, unknown>, remoteMatchesCrm: Record<string, unknown>) {
    setupReview(row, remote);
    mocks.selectFrom.mockImplementation((table: string) => {
      const results: Record<string, unknown[]> = {
        order_quotations: [row, row],
        orders: [REVIEW_ORDER, REVIEW_ORDER],
        customer_zoho_links: [{ zoho_contact_id: "contact-1" }, { zoho_contact_id: "contact-1" }],
      };
      return builder(results[table]?.shift());
    });
    mocks.getZohoEstimate.mockReset();
    mocks.getZohoEstimate
      .mockResolvedValueOnce(remote)
      .mockResolvedValueOnce(remote)
      .mockResolvedValue(remoteMatchesCrm);
    mocks.syncZohoEstimate.mockResolvedValue({ estimate_id: "est-1", estimate_number: "QT-677816" });
  }

  it("claims the previewed conflict row once and pushes the saved CRM version to the same estimate", async () => {
    const row = reviewRow();
    const remote = reviewRemote();
    setupReviewedSync(row, remote, makeRemote({ status: "sent", last_modified_time: "t9" }));

    await overwriteZohoWithCrmQuotation(reviewInput(row, remote));

    // One claim straight to syncing — no reset-to-local_draft window that an
    // unpreviewed save could slip through.
    expect(setCalls[0]).toMatchObject({ status: "syncing" });
    expect(setCalls.find((values) => values.status === "local_draft")).toBeUndefined();
    expect(mocks.syncZohoEstimate).toHaveBeenCalledWith(expect.objectContaining({ estimateId: "est-1" }));
    expect(setCalls.find((values) => values.status === "zoho_draft")).toBeTruthy();
    const audit = insertCalls.find((values) => "note" in values);
    expect(String(audit?.note)).toContain("overwrote Zoho Books");
  });

  it("pushes a previously-sent quotation whose Zoho copy was edited", async () => {
    // A plain sync refuses a sent row outright; the reviewed binding is the
    // approval to push the CRM side back over the remote edit.
    const row = reviewRow({ status: "sent", sent_at: new Date("2026-09-20T00:00:00Z"), sent_by: "consult-1", sent_channel: "WhatsApp" });
    const remote = reviewRemote({ last_modified_time: "t10" });
    setupReviewedSync(row, remote, makeRemote({ status: "sent", last_modified_time: "t10" }));

    await overwriteZohoWithCrmQuotation(reviewInput(row, remote));

    expect(mocks.syncZohoEstimate).toHaveBeenCalledWith(expect.objectContaining({ estimateId: "est-1" }));
    expect(setCalls.find((values) => values.status === "sent")).toBeTruthy();
    expect(insertCalls.find((values) => "version" in values)).toBeTruthy();
  });

  it("pushes a zoho_draft quotation whose remote drifted — the review approves that exact drift", async () => {
    const row = reviewRow({ status: "zoho_draft" });
    // Remote moved (t10 vs stored t9) and carries different lines, so a plain
    // sync would report drift; the reviewed fingerprint is what authorizes it.
    const remote = reviewRemote({ last_modified_time: "t10" });
    setupReviewedSync(row, remote, makeRemote({ status: "sent", last_modified_time: "t10" }));

    await overwriteZohoWithCrmQuotation(reviewInput(row, remote));

    expect(mocks.syncZohoEstimate).toHaveBeenCalled();
    expect(setCalls.find((values) => values.status === "zoho_draft")).toBeTruthy();
  });

  it("loses the atomic claim when the row was saved after the preview", async () => {
    const row = reviewRow();
    const remote = reviewRemote();
    setupReviewedSync(row, remote, makeRemote({ status: "sent", last_modified_time: "t9" }));
    mocks.updateTable.mockImplementation(() => builder(undefined)); // another save won the claim

    await expect(overwriteZohoWithCrmQuotation(reviewInput(row, remote))).rejects.toThrow("changed or is already syncing");
    expect(mocks.syncZohoEstimate).not.toHaveBeenCalled();
  });

  it("rejects when Zoho changed while its PDF was downloading", async () => {
    const row = reviewRow();
    const remote = reviewRemote();
    const remoteMatchesCrm = makeRemote({ status: "sent", last_modified_time: "t9" });
    setupReviewedSync(row, remote, remoteMatchesCrm);
    mocks.getZohoEstimate.mockReset();
    mocks.getZohoEstimate
      .mockResolvedValueOnce(remote)
      .mockResolvedValueOnce(remote)
      .mockResolvedValueOnce(remoteMatchesCrm)
      .mockResolvedValue({ ...remoteMatchesCrm, notes: "changed during download", last_modified_time: "t11" });

    await expect(overwriteZohoWithCrmQuotation(reviewInput(row, remote))).rejects.toThrow("while its PDF was being fetched");
    // Recoverable failure — the row lands back on sync_failed, not a false success.
    expect(setCalls.find((values) => values.status === "sync_failed")).toBeTruthy();
    expect(setCalls.find((values) => values.status === "zoho_draft")).toBeUndefined();
  });

  it("rejects when Zoho moved since the preview before any write", async () => {
    const row = reviewRow();
    const remote = reviewRemote();
    setupReview(row, remote);

    await expect(overwriteZohoWithCrmQuotation({ ...reviewInput(row, remote), remoteFingerprint: "stale" }))
      .rejects.toThrow("changed since it was previewed");

    expect(setCalls).toHaveLength(0);
    expect(mocks.syncZohoEstimate).not.toHaveBeenCalled();
  });
});

describe("UI action wrappers", () => {
  it("returns a guard message instead of throwing", async () => {
    mocks.selectFrom.mockImplementation(() => builder(undefined));
    await expect(syncQuotationUi(QUOTE_ID)).resolves.toEqual({ ok: false, error: "Quotation not found" });
  });
  it("hides unexpected errors behind a fallback", async () => {
    mocks.selectFrom.mockImplementation(() => { throw new Error("connection terminated unexpectedly"); });
    const result = await saveQuotationUi({ orderId: ORDER_ID, quotationId: null, expectedUpdatedAt: null, issueDate: "2026-09-24", expiryDate: null, lines: LINES, customerMessage: "", notes: "", terms: "" });
    expect(result).toEqual({ ok: false, error: "The quotation could not be saved. Refresh and try again." });
  });
});

const reconciliationSqlCalls: Array<{ sql: string; parameters: unknown[] }> = [];
function setupInvoiced(patch: Record<string, unknown> = {}, orderPatch: Record<string, unknown> = {}, remotePatch: Record<string, unknown> = {}, invoicePatch: Record<string, unknown> = {}) {
  const row = reviewRow({ status: "zoho_draft", zoho_payment_id: "existing-payment", payment_sync_state: "created", ...patch });
  const remote = reviewRemote({ status: "invoiced", invoice_ids: ["inv-existing"], ...remotePatch });
  const invoice = { invoice_id: "inv-existing", invoice_number: "INV-42", customer_id: "contact-1", currency_code: "SGD", status: "paid", total: 810, line_items: remote.line_items, payment_made: 810, balance: 0, ...invoicePatch };
  const order = { ...REVIEW_ORDER, current_status: "deposit_received", price_quoted_cents: 81000, deposit_cents: 40000, lead_id: "lead-1", appointment_id: null, ...orderPatch };
  setupReview(row, remote);
  const results: Record<string, unknown[]> = { order_quotations: [row], orders: [order], customer_zoho_links: [{ zoho_contact_id: "contact-1" }] };
  mocks.selectFrom.mockImplementation((table: string) => builder(results[table]?.shift()));
  let quoteReads = 0;
  reconciliationSqlCalls.length = 0;
  const tx = {
    getExecutor: () => ({
      transformQuery: (node: unknown) => node,
      compileQuery: (node: { sqlFragments: string[]; parameters: Array<{ value: unknown }> }) => ({ sql: node.sqlFragments.join("?"), parameters: node.parameters.map(param => param.value) }),
      executeQuery: async (query: { sql: string; parameters: unknown[] }) => { reconciliationSqlCalls.push(query); return { rows: [] }; },
    }),
    selectFrom: (table: string) => {
      if (table === "orders") return builder(order);
      if (table === "order_quotations") return builder(quoteReads++ === 0 ? row : { ...row, status: "syncing", sync_claim_token: setCalls.find(v => v.sync_claim_token)?.sync_claim_token });
      return builder(table === "order_quotation_versions" ? { max_version: 1 } : { id: "lead-1" });
    },
    updateTable: () => builder({ id: QUOTE_ID }), insertInto: () => builder({}),
  };
  mocks.transaction.mockReturnValue({ execute: async (cb: (trx: typeof tx) => unknown) => cb(tx) });
  mocks.getZohoInvoice.mockResolvedValue(invoice);
  return { row, remote, invoice, order, input: { ...reviewInput(row, remote), invoiceFingerprint: invoiceFingerprint(invoice), orderFingerprint: orderReconciliationFingerprint(order) } };
}

describe("existing invoiced quotation reconciliation", () => {
  it("previews invoiced details with visible overwrite blocker and unknown missing payment facts", async () => {
    const { invoice } = setupInvoiced();
    mocks.getZohoInvoice.mockResolvedValue({ ...invoice, payment_made: undefined, balance: undefined });
    const preview = await previewQuotationZohoDiff(QUOTE_ID);
    expect(preview.adoptIssues).toEqual([]);
    expect(preview.overwriteBlockedReason).toContain("invoice");
    expect(preview.invoice).toMatchObject({ paidCents: null, balanceCents: null, creditsCents: null });
    expect(preview.financialDifferences).toEqual([]);
    expect(preview.requiresFinancialAcknowledgement).toBe(false);
  });
  it("previews financial differences as non-blocking warnings with exact totals", async () => {
    setupInvoiced({}, { price_quoted_cents: 473000, deposit_cents: 236500 }, { total: 4390, line_items: [{ name: "Curtain", quantity: 1, rate: 4390, discount: "0%" }] }, { total: 4730, payment_made: 2365, balance: 2365 });
    const preview = await previewQuotationZohoDiff(QUOTE_ID);
    expect(preview.adoptIssues).toEqual([]);
    expect(preview.requiresFinancialAcknowledgement).toBe(true);
    expect(preview.financialDifferences.join(" ")).toContain("S$4,730.00");
    expect(preview.financialDifferences.join(" ")).toContain("S$4,390.00");
    expect(preview.invoice).toMatchObject({ totalCents: 473000, paidCents: 236500, balanceCents: 236500 });
    expect(preview.currentOrderTotalCents).toBe(473000);
  });
  it.each([false, true])("links the same invoice and preserves payment/stage/sent attribution (previously sent %s)", async sent => {
    const { input } = setupInvoiced(sent ? { sent_at: new Date("2026-10-01"), sent_by: "original", sent_channel: "WhatsApp", zoho_invoice_id: "inv-existing" } : {});
    await expect(reconcileInvoicedZohoQuotation(input)).resolves.toEqual({ invoiceNumber: "INV-42" });
    const saved = setCalls.find(value => value.zoho_invoice_id === "inv-existing");
    expect(saved).toMatchObject({ status: sent ? "sent" : "zoho_draft", quoted_total_cents: 81000, invoice_sync_state: "created" });
    for (const values of setCalls) for (const key of ["zoho_payment_id", "payment_sync_state", "deposit_cents", "current_status", "sent_at", "sent_by", "sent_channel", "price_quoted_cents", "latest_quote_cents"]) expect(values).not.toHaveProperty(key);
    expect(reconciliationSqlCalls).toEqual([]);
    expect(insertCalls.some(value => value.quotation_id === QUOTE_ID)).toBe(true);
    for (const fn of [mocks.syncZohoEstimate, mocks.markZohoEstimateSent, mocks.convertZohoEstimateToInvoice, mocks.renameZohoInvoice, mocks.createZohoCustomerPayment]) expect(fn).not.toHaveBeenCalled();
  });
  it.each([{ zoho_invoice_id: "other" }, { invoice_sync_state: "pending" }, { payment_sync_state: "uncertain" }])("rejects incompatible local financial state %j before storage", async patch => {
    const { input } = setupInvoiced(patch);
    await expect(reconcileInvoicedZohoQuotation(input)).rejects.toThrow();
    expect(mocks.getZohoEstimatePdf).not.toHaveBeenCalled();
    expect(setCalls).toEqual([]);
  });
  it("requires explicit acknowledgement when the quotation total differs from the order", async () => {
    const { input } = setupInvoiced({}, { price_quoted_cents: 90000 });
    await expect(reconcileInvoicedZohoQuotation(input)).rejects.toThrow("Acknowledge the differences");
    expect(mocks.getZohoEstimatePdf).not.toHaveBeenCalled();
    expect(setCalls).toEqual([]);
  });
  it("requires acknowledgement when invoice lines differ although the totals match", async () => {
    const { input } = setupInvoiced({}, {}, {}, { line_items: [{ name: "Other", quantity: 1, rate: 810 }] });
    await expect(reconcileInvoicedZohoQuotation(input)).rejects.toThrow("Acknowledge the differences");
    expect(mocks.getZohoEstimatePdf).not.toHaveBeenCalled();
  });
  it("imports the exact 4390/4730/2365 mismatch with acknowledgement and changes no money", async () => {
    const { input } = setupInvoiced(
      {},
      { price_quoted_cents: 473000, deposit_cents: 236500 },
      { total: 4390, line_items: [{ name: "Curtain", quantity: 1, rate: 4390, discount: "0%" }] },
      { total: 4730, payment_made: 2365, balance: 2365 },
    );
    await expect(reconcileInvoicedZohoQuotation({ ...input, acknowledgeFinancialDifference: true })).resolves.toEqual({ invoiceNumber: "INV-42" });
    const saved = setCalls.find(value => value.zoho_invoice_id === "inv-existing");
    expect(saved).toMatchObject({ quoted_total_cents: 439000, invoice_sync_state: "created" });
    expect(reconciliationSqlCalls).toEqual([]);
    for (const values of setCalls) for (const key of ["price_quoted_cents", "latest_quote_cents", "deposit_cents", "zoho_payment_id", "payment_sync_state"]) expect(values).not.toHaveProperty(key);
    const audit = insertCalls.find(value => "note" in value);
    expect(String(audit?.note)).toContain("Acknowledged financial differences");
    expect(String(audit?.note)).toContain("S$4,730.00");
    for (const fn of [mocks.convertZohoEstimateToInvoice, mocks.renameZohoInvoice, mocks.createZohoCustomerPayment]) expect(fn).not.toHaveBeenCalled();
  });
  it("rejects a different consultant before touching Zoho", async () => {
    const { input } = setupInvoiced();
    mocks.requireSession.mockResolvedValue({ user: { id: "stranger" }, profile: { role: "consultant" } });
    await expect(reconcileInvoicedZohoQuotation(input)).rejects.toThrow();
    expect(mocks.getZohoEstimate).not.toHaveBeenCalled();
  });
  it.each(["order", "invoice", "quote", "estimate"])("rejects stale %s snapshot before storage", async target => {
    const { input } = setupInvoiced();
    const key = { order: "orderFingerprint", invoice: "invoiceFingerprint", quote: "expectedUpdatedAt", estimate: "remoteFingerprint" }[target]!;
    await expect(reconcileInvoicedZohoQuotation({ ...input, [key]: target === "quote" ? "2026-01-01T00:00:00.000Z" : "stale" })).rejects.toThrow();
    expect(mocks.getZohoEstimatePdf).not.toHaveBeenCalled();
  });
  it("detects payment changes during PDF download without linking invoice", async () => {
    const { input, invoice } = setupInvoiced();
    mocks.getZohoInvoice.mockResolvedValueOnce(invoice).mockResolvedValueOnce({ ...invoice, payment_made: 811 });
    await expect(reconcileInvoicedZohoQuotation(input)).rejects.toThrow("while the PDF");
    expect(setCalls.some(value => value.zoho_invoice_id)).toBe(false);
    expect(insertCalls).toEqual([]);
    expect(setCalls.at(-1)).toMatchObject({ status: "zoho_draft", sync_claim_token: null });
  });
  it("does not link or change totals when PDF storage fails", async () => {
    const { input } = setupInvoiced();
    mocks.adminClient.mockReturnValue({ storage: { from: () => ({ upload: async () => ({ error: new Error("storage failed") }) }) } });
    await expect(reconcileInvoicedZohoQuotation(input)).rejects.toThrow();
    expect(setCalls.some(value => value.zoho_invoice_id || value.price_quoted_cents)).toBe(false);
    expect(insertCalls).toEqual([]);
  });
});


describe("invoiced reconciliation authorization and final snapshot checks", () => {
  it("allows the assigned consultant when the frozen total already matches", async () => {
    const { input } = setupInvoiced();
    mocks.requireSession.mockResolvedValue({ user: { id: "consult-1" }, profile: { role: "consultant" } });
    await expect(reconcileInvoicedZohoQuotation(input)).resolves.toMatchObject({ invoiceNumber: "INV-42" });
    expect(reconciliationSqlCalls).toEqual([]);
  });
  it("lets the assigned consultant acknowledge differences on an owned order without any money edit", async () => {
    const { input } = setupInvoiced({}, { price_quoted_cents: 90000 });
    mocks.requireSession.mockResolvedValue({ user: { id: "consult-1" }, profile: { role: "consultant" } });
    await expect(reconcileInvoicedZohoQuotation({ ...input, acknowledgeFinancialDifference: true })).resolves.toMatchObject({ invoiceNumber: "INV-42" });
    expect(reconciliationSqlCalls).toEqual([]);
    for (const values of setCalls) for (const key of ["price_quoted_cents", "latest_quote_cents", "deposit_cents"]) expect(values).not.toHaveProperty(key);
  });
  it("never calls the order-payment repair even for an admin on a mismatched total", async () => {
    const { input } = setupInvoiced({}, { price_quoted_cents: 90000 });
    await reconcileInvoicedZohoQuotation({ ...input, acknowledgeFinancialDifference: true });
    expect(reconciliationSqlCalls).toEqual([]);
    for (const values of setCalls) for (const key of ["price_quoted_cents", "latest_quote_cents", "deposit_cents"]) expect(values).not.toHaveProperty(key);
    const audit = insertCalls.find(value => "note" in value);
    expect(String(audit?.note)).toContain("Acknowledged financial differences");
    expect(String(audit?.note)).toContain("S$900.00");
  });
  it("rejects an order stage change during PDF storage before committing invoice or history", async () => {
    const { input, order } = setupInvoiced();
    mocks.getZohoEstimatePdf.mockImplementation(async () => { order.current_status = "sent_to_vendor"; return new Uint8Array([37, 80, 68, 70]); });
    await expect(reconcileInvoicedZohoQuotation(input)).rejects.toThrow("order amounts or stage changed");
    expect(setCalls.some(value => value.zoho_invoice_id)).toBe(false);
    expect(insertCalls).toEqual([]);
  });
  it("rejects a changed estimate during PDF storage", async () => {
    const { input, remote } = setupInvoiced();
    mocks.getZohoEstimate.mockResolvedValueOnce(remote).mockResolvedValueOnce({ ...remote, notes: "new remote notes" });
    await expect(reconcileInvoicedZohoQuotation(input)).rejects.toThrow("while the PDF");
    expect(setCalls.some(value => value.zoho_invoice_id)).toBe(false);
  });
  it("rejects a quote already claimed by another process", async () => {
    const { input } = setupInvoiced({ status: "syncing" });
    await expect(reconcileInvoicedZohoQuotation(input)).rejects.toThrow("still in progress");
    expect(mocks.getZohoEstimatePdf).not.toHaveBeenCalled();
  });
});
