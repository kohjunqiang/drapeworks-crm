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

import { estimateSnapshotHash, quotePayloadHash } from "@/lib/quotations/hash";
import { QUOTATION_INVOICED_MESSAGE } from "@/lib/quotations/lifecycle";
import { toZohoEstimatePayload } from "@/lib/quotations/model";
import { UserFacingError } from "@/lib/user-facing-error";
import { acknowledgeZohoConflict, confirmQuotationSent, createQuotationRevision, ensureZohoInvoiceForOrder, ensureZohoInvoiceForOrderUi, importExistingZohoQuotation, saveQuotation, saveQuotationUi, syncQuotation, syncQuotationUi } from "./quotations";

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

describe("invoice numbering on the quotation's suffix", () => {
  // The estimate gains its invoice link only after conversion: a first read
  // without invoice_ids lets the action convert, later reads carry the link
  // for verification.
  const unlinkedRemote = () => makeRemote({ estimate_number: "QT-677816", invoice_ids: [] });
  const linkedRemote = () => makeRemote({ estimate_number: "QT-677816", invoice_ids: ["inv-1"] });
  const recordedPayment = () => {
    mocks.createZohoCustomerPayment.mockResolvedValue({ payment_id: "pay-1", payment_number: "91" });
    mocks.getZohoCustomerPayment.mockResolvedValue({
      payment_id: "pay-1", payment_number: "91", customer_id: "contact-1",
      payment_mode: "PayNow", amount: 1000, account_id: "acc-1",
      invoices: [{ invoice_id: "inv-1", invoice_number: "INV-677816", amount_applied: 1000 }],
    });
  };

  it("renames an auto-numbered invoice and stores the tallied number", async () => {
    setup({ quote: makeQuote(CANONICAL_HASH), remote: linkedRemote() });
    mocks.getZohoEstimate.mockResolvedValueOnce(unlinkedRemote());
    mocks.convertZohoEstimateToInvoice.mockResolvedValue({ invoice_id: "inv-1", invoice_number: "INV-900001" });
    mocks.getZohoInvoice
      .mockResolvedValueOnce({ invoice_id: "inv-1", invoice_number: "INV-900001", status: "sent", customer_id: "contact-1", currency_code: "SGD", total: 2010 })
      .mockResolvedValueOnce({ invoice_id: "inv-1", invoice_number: "INV-677816", status: "sent", customer_id: "contact-1", currency_code: "SGD", total: 2010 });
    mocks.renameZohoInvoice.mockResolvedValue({ invoice_id: "inv-1", invoice_number: "INV-677816" });
    recordedPayment();

    await expect(ensureZohoInvoiceForOrder(ORDER_ID)).resolves.toBeUndefined();

    expect(mocks.renameZohoInvoice).toHaveBeenCalledWith("inv-1", "INV-677816");
    expect(mocks.getZohoInvoice).toHaveBeenCalledTimes(2);
    const finalized = setCalls.find((values) => values.invoice_sync_state === "created");
    expect(finalized).toMatchObject({ zoho_invoice_id: "inv-1", zoho_invoice_number: "INV-677816" });
  });

  it("does not rename an invoice that already carries the expected number", async () => {
    setup({ quote: makeQuote(CANONICAL_HASH), remote: linkedRemote() });
    mocks.getZohoInvoice.mockResolvedValue({ invoice_id: "inv-1", invoice_number: "INV-677816", status: "sent", customer_id: "contact-1", currency_code: "SGD", total: 2010 });
    recordedPayment();

    await expect(ensureZohoInvoiceForOrder(ORDER_ID)).resolves.toBeUndefined();

    expect(mocks.renameZohoInvoice).not.toHaveBeenCalled();
    expect(mocks.getZohoInvoice).toHaveBeenCalledTimes(1);
  });

  it("fails before conversion and releases the claim when invoice numbering consent is missing", async () => {
    setup({ quote: makeQuote(CANONICAL_HASH), remote: linkedRemote() });
    mocks.assertZohoInvoiceNumberingReady.mockRejectedValue(
      new UserFacingError("Zoho Books needs permission to number invoices. Nothing was sent to Zoho. To fix: an admin opens Integrations in the top menu, clicks Reconnect Zoho Books, signs in to Zoho and clicks Accept. Then try again."));

    const result = await ensureZohoInvoiceForOrderUi(ORDER_ID);

    expect(result).toEqual({
      ok: false,
      error: "Zoho Books needs permission to number invoices. Nothing was sent to Zoho. To fix: an admin opens Integrations in the top menu, clicks Reconnect Zoho Books, signs in to Zoho and clicks Accept. Then try again.",
    });
    expect(mocks.convertZohoEstimateToInvoice).not.toHaveBeenCalled();
    expect(mocks.createZohoCustomerPayment).not.toHaveBeenCalled();
    expect(setCalls.some((values) => values.invoice_sync_state === "failed")).toBe(true);
    expect(setCalls.some((values) => values.invoice_sync_state === "uncertain")).toBe(false);
  });

  it("fails the claim and names the intended number when Zoho rejects the rename", async () => {
    setup({ quote: makeQuote(CANONICAL_HASH), remote: linkedRemote() });
    mocks.getZohoInvoice.mockResolvedValue({ invoice_id: "inv-1", invoice_number: "INV-900001", status: "sent", customer_id: "contact-1", currency_code: "SGD", total: 2010 });
    mocks.renameZohoInvoice.mockRejectedValue(new Error("The invoice number already exists"));

    const result = await ensureZohoInvoiceForOrderUi(ORDER_ID);

    expect(result).toEqual({
      ok: false,
      error: "The Zoho invoice was created but could not be numbered INV-677816 (The invoice number already exists). Fix the number in Zoho Books or retry.",
    });
    expect(mocks.createZohoCustomerPayment).not.toHaveBeenCalled();
    // The stored invoice id lets the retry re-enter and re-attempt the rename,
    // so this is a failure, not an uncertainty.
    expect(setCalls.some((values) => values.invoice_sync_state === "failed")).toBe(true);
    expect(setCalls.some((values) => values.invoice_sync_state === "uncertain")).toBe(false);
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

  it("reconciles a conflict row when the remote never had a CRM Quote Key", async () => {
    setupSync(
      { ...editedSentRow(), status: "conflict" },
      makeRemote({ status: "sent", last_modified_time: "t5", custom_fields: [] }),
      [],
    );

    const rejection = await acknowledgeZohoConflict(QUOTE_ID).catch((error: unknown) => error);

    expect(setCalls[0]).toMatchObject({ status: "local_draft", zoho_last_modified_time: "t5" });
    expect(rejection).toBeInstanceOf(Error);
    expect((rejection as Error).message).not.toContain("CRM Quote Key");
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

describe("reconcile and deposit with editable quotations", () => {
  it("reconciles a sent Zoho estimate by overwriting it from the CRM", async () => {
    const row = { ...makeQuote(CANONICAL_HASH), status: "conflict", zoho_estimate_id: "est-1", sent_at: new Date(), updated_at: new Date() };
    mocks.selectFrom.mockImplementation((table: string) => builder(table === "order_quotations" ? row : table === "orders" ? { id: ORDER_ID, current_status: "quotation_sent", consultant_id: "consult-1", customer_id: "cust-1" } : undefined));
    mocks.getZohoEstimate.mockResolvedValue(makeRemote({ status: "sent", last_modified_time: "t5" }));
    mocks.getZohoBooksBinding.mockResolvedValue({ crmKeyFieldId: "cf-1", crmKeyApiName: "cf_crm_quote_key", estimateTemplateId: "tmpl-1" });
    mocks.updateTable.mockImplementation(() => builder(undefined)); // no Zoho customer link, so the follow-up sync stops right after the reset

    await expect(acknowledgeZohoConflict(QUOTE_ID)).rejects.toThrow();
    expect(setCalls[0]).toMatchObject({ status: "local_draft", zoho_last_modified_time: "t5" });
  });

  it("asks to sync unsynced edits before the deposit", async () => {
    // Reuse setup(...) from the ensureZohoInvoiceForOrder tests with a previously-sent local_draft quote.
    setup({ quote: { ...makeQuote(CANONICAL_HASH), status: "local_draft", sent_at: new Date() }, remote: makeRemote() });
    await expect(ensureZohoInvoiceForOrder(ORDER_ID)).rejects.toThrow("Sync the latest quotation changes to Zoho before recording the deposit");
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
