import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./connection", () => ({
  getZohoAccessContext: vi.fn(async () => ({ accessToken: "token", organizationId: "org", apiBaseUrl: "https://www.zohoapis.com/books/v3", crmKeyApiName: "cf_crm_quote_key", crmKeyFieldId: "field", estimateTemplateId: "template", requestedScopes: ["ZohoBooks.invoices.UPDATE", "ZohoBooks.customerpayments.READ", "ZohoBooks.customerpayments.CREATE"] })),
  getZohoConnectionSummary: vi.fn(async () => ({ connection: { status: "connected", estimate_crm_key_api_name: "cf_crm_quote_key", estimate_crm_key_id: "field", estimate_template_id: "template", verified_capabilities: { crmKeyUnique: false } } })),
}));

const envelope = (body: unknown, status = 200, headers?: Record<string, string>) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

beforeEach(() => {
  vi.resetModules();
  process.env.ZOHO_OAUTH_CLIENT_ID = "client";
  process.env.ZOHO_OAUTH_CLIENT_SECRET = "secret";
  process.env.ZOHO_ESTIMATE_CRM_KEY_API_NAME = "cf_crm_quote_key";
  process.env.ZOHO_ESTIMATE_CRM_KEY_ID = "field";
  process.env.ZOHO_ESTIMATE_TEMPLATE_ID = "template";
  process.env.ZOHO_PAYMENT_ACCOUNT_ID = "8639631000000122011";
});

describe("Zoho Books transport safety", () => {
  it("creates an estimate only after checking the CRM Quote Key", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(envelope({ code: 0, estimates: [], page_context: { has_more_page: false } }))
      .mockResolvedValueOnce(envelope({ code: 0, estimate: { estimate_id: "new", estimate_number: "Q-1", status: "draft", total: 100 } }));
    vi.stubGlobal("fetch", fetchMock);
    const { syncZohoEstimate } = await import("./books");
    await expect(syncZohoEstimate({ crmQuoteKey: "crm-key", payload: { customer_id: "customer" } })).resolves.toMatchObject({ estimate_id: "new" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain("custom_field=");
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "POST" });
  });

  it("checks full estimate records when reconciling a non-unique CRM Quote Key", async () => {
    const unrelated = { estimate_id: "other", estimate_number: "Q-0", status: "draft", total: 50 };
    const matching = { estimate_id: "match", estimate_number: "Q-1", status: "draft", total: 100 };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(envelope({ code: 0, estimates: [unrelated, matching], page_context: { has_more_page: false } }))
      .mockResolvedValueOnce(envelope({ code: 0, estimate: { ...unrelated, custom_fields: [] } }))
      .mockResolvedValueOnce(envelope({ code: 0, estimate: { ...matching, custom_fields: [{ api_name: "cf_crm_quote_key", value: "crm-key" }] } }));
    vi.stubGlobal("fetch", fetchMock);
    const { findZohoEstimatesByCrmQuoteKey } = await import("./books");
    await expect(findZohoEstimatesByCrmQuoteKey("crm-key")).resolves.toEqual([
      expect.objectContaining({ estimate_id: "match" }),
    ]);
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain("custom_field=");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("uses Zoho's unique-field upsert when the bound CRM key is unique", async () => {
    const connection = await import("./connection");
    vi.mocked(connection.getZohoConnectionSummary).mockResolvedValueOnce({
      connection: { status: "connected", verified_capabilities: { crmKeyUnique: true } },
    } as unknown as Awaited<ReturnType<typeof connection.getZohoConnectionSummary>>);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(envelope({ code: 0, estimates: [], page_context: { has_more_page: false } }))
      .mockResolvedValueOnce(envelope({ code: 0, estimate: { estimate_id: "upserted", estimate_number: "Q-2", status: "draft", total: 100 } }));
    vi.stubGlobal("fetch", fetchMock);
    const { syncZohoEstimate } = await import("./books");
    await expect(syncZohoEstimate({ crmQuoteKey: "unique-key", payload: { customer_id: "customer" } })).resolves.toMatchObject({ estimate_id: "upserted" });
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "PUT", headers: {
      "X-Unique-Identifier-Key": "cf_crm_quote_key", "X-Unique-Identifier-Value": "unique-key", "X-Upsert": "true",
    } });
  });

  it("updates a known estimate by id without a lookup or create", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(envelope({ code: 0, estimate: { estimate_id: "known", estimate_number: "Q-1", status: "draft", total: 100 } }));
    vi.stubGlobal("fetch", fetchMock);
    const { syncZohoEstimate } = await import("./books");
    await expect(syncZohoEstimate({ crmQuoteKey: "crm-key", payload: {}, estimateId: "known" })).resolves.toMatchObject({ estimate_id: "known" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/estimates/known");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "PUT" });
  });

  it("finds an existing estimate by its exact quotation number", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(envelope({ code: 0, estimates: [
      { estimate_id: "match", estimate_number: "QT-677806", status: "draft", total: 1500 },
      { estimate_id: "other", estimate_number: "QT-677806-A", status: "draft", total: 1500 },
    ] }));
    vi.stubGlobal("fetch", fetchMock);
    const { findZohoEstimateByNumber } = await import("./books");

    await expect(findZohoEstimateByNumber("QT-677806")).resolves.toEqual([
      expect.objectContaining({ estimate_id: "match" }),
    ]);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("estimate_number=QT-677806");
  });

  it("reconciles an uncertain create response by CRM Quote Key without posting twice", async () => {
    const recovered = {
      estimate_id: "recovered", estimate_number: "Q-1", status: "draft", total: 100,
      custom_fields: [{ api_name: "cf_crm_quote_key", value: "crm-key" }],
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(envelope({ code: 0, estimates: [], page_context: { has_more_page: false } }))
      .mockResolvedValueOnce(envelope({ code: 1, message: "uncertain" }, 500))
      .mockResolvedValueOnce(envelope({ code: 0, estimates: [recovered], page_context: { has_more_page: false } }))
      .mockResolvedValueOnce(envelope({ code: 0, estimate: recovered }));
    vi.stubGlobal("fetch", fetchMock);
    const { syncZohoEstimate } = await import("./books");
    await expect(syncZohoEstimate({ crmQuoteKey: "crm-key", payload: {} })).resolves.toMatchObject({ estimate_id: "recovered" });
    expect(fetchMock.mock.calls.filter((call) => call[1]?.method === "POST" && String(call[0]).includes("/estimates"))).toHaveLength(1);
  });

  it("never retries a non-idempotent invoice POST", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(envelope({ code: 1, message: "uncertain" }, 500));
    vi.stubGlobal("fetch", fetchMock);
    const { convertZohoEstimateToInvoice } = await import("./books");
    await expect(convertZohoEstimateToInvoice("estimate")).rejects.toThrow("uncertain");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("renames an invoice with auto-number generation disabled", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(envelope({ code: 0, invoice: { invoice_id: "inv-1", invoice_number: "INV-677816" } }));
    vi.stubGlobal("fetch", fetchMock);
    const { renameZohoInvoice } = await import("./books");

    await expect(renameZohoInvoice("inv-1", "INV-677816")).resolves.toMatchObject({ invoice_id: "inv-1", invoice_number: "INV-677816" });

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/invoices/inv-1");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("ignore_auto_number_generation=true");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "PUT" });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ invoice_number: "INV-677816" });
  });

  it("throws when Zoho does not return the renamed invoice", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(envelope({ code: 0 }));
    vi.stubGlobal("fetch", fetchMock);
    const { renameZohoInvoice } = await import("./books");

    await expect(renameZohoInvoice("inv-1", "INV-677816")).rejects.toThrow("did not return the renumbered invoice");
  });

  it("blocks the invoice rename before any Zoho call when update consent is missing", async () => {
    const connection = await import("./connection");
    vi.mocked(connection.getZohoAccessContext).mockResolvedValueOnce({
      accessToken: "token", organizationId: "org", apiBaseUrl: "https://www.zohoapis.com/books/v3",
      crmKeyApiName: "cf_crm_quote_key", crmKeyFieldId: "field", estimateTemplateId: "template",
      connectionId: "connection", tokenVersion: 1,
      requestedScopes: ["ZohoBooks.invoices.READ", "ZohoBooks.invoices.CREATE"],
    });
    vi.stubGlobal("fetch", vi.fn());
    const { renameZohoInvoice } = await import("./books");

    await expect(renameZohoInvoice("inv-1", "INV-677816")).rejects.toThrow("Zoho Books must be reconnected by an admin to authorize invoice numbering");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("assertZohoInvoiceNumberingReady passes only when invoice update consent was granted", async () => {
    const connection = await import("./connection");
    const { assertZohoInvoiceNumberingReady } = await import("./books");

    await expect(assertZohoInvoiceNumberingReady()).resolves.toBeUndefined();

    vi.mocked(connection.getZohoAccessContext).mockResolvedValueOnce({
      accessToken: "token", organizationId: "org", apiBaseUrl: "https://www.zohoapis.com/books/v3",
      crmKeyApiName: "cf_crm_quote_key", crmKeyFieldId: "field", estimateTemplateId: "template",
      connectionId: "connection", tokenVersion: 1,
      requestedScopes: ["ZohoBooks.invoices.READ", "ZohoBooks.invoices.CREATE"],
    });
    await expect(assertZohoInvoiceNumberingReady()).rejects.toThrow("Zoho Books must be reconnected by an admin to authorize invoice numbering");
  });

  it("records a PayNow deposit against one invoice and the configured bank account", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(envelope({ code: 0, payment: { payment_id: "payment-1", payment_number: "91" } }));
    vi.stubGlobal("fetch", fetchMock);
    const { createZohoCustomerPayment } = await import("./books");

    await expect(createZohoCustomerPayment({
      customerId: "customer-1", invoiceId: "invoice-1", amountCents: 75000,
      date: "2026-09-07", referenceNumber: "CRM-DW-2026-0025-DEPOSIT",
      accountId: "8639631000000122011", paymentMode: "PayNow",
    })).resolves.toMatchObject({ payment_id: "payment-1" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "POST" });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      customer_id: "customer-1", payment_mode: "PayNow", amount: 750,
      account_id: "8639631000000122011",
      invoices: [{ invoice_id: "invoice-1", amount_applied: 750 }],
    });
  });

  it("blocks the workflow before invoice creation when payment write consent is missing", async () => {
    const connection = await import("./connection");
    vi.mocked(connection.getZohoAccessContext).mockResolvedValueOnce({
      accessToken: "token", organizationId: "org", apiBaseUrl: "https://www.zohoapis.com/books/v3",
      crmKeyApiName: "cf_crm_quote_key", crmKeyFieldId: "field", estimateTemplateId: "template",
      connectionId: "connection", tokenVersion: 1, requestedScopes: ["ZohoBooks.customerpayments.READ"],
    });
    vi.stubGlobal("fetch", vi.fn());
    const { assertZohoCustomerPaymentsReady } = await import("./books");

    await expect(assertZohoCustomerPaymentsReady()).rejects.toThrow("reconnected");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("never retries a non-idempotent customer payment POST", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(envelope({ code: 1, message: "uncertain" }, 500));
    vi.stubGlobal("fetch", fetchMock);
    const { createZohoCustomerPayment } = await import("./books");

    await expect(createZohoCustomerPayment({
      customerId: "customer-1", invoiceId: "invoice-1", amountCents: 75000,
      date: "2026-09-07", referenceNumber: "CRM-DW-2026-0025-DEPOSIT",
      accountId: "8639631000000122011", paymentMode: "PayNow",
    })).rejects.toThrow("uncertain");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a safe GET after a transient Zoho response", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(envelope({ code: 1070, message: "busy" }))
      .mockResolvedValueOnce(envelope({ code: 0, items: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const { listZohoItems } = await import("./books");
    await expect(listZohoItems()).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects a successful HTTP response that is not a PDF", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("<html>login</html>", { status: 200, headers: { "content-type": "text/html" } }));
    vi.stubGlobal("fetch", fetchMock);
    const { getZohoEstimatePdf } = await import("./books");
    await expect(getZohoEstimatePdf("estimate")).rejects.toThrow("invalid quotation PDF");
  });

  it("downloads an invoice as a validated PDF", async () => {
    const pdf = `%PDF-${"x".repeat(120)}`;
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(pdf, { status: 200, headers: { "content-type": "application/pdf" } }));
    vi.stubGlobal("fetch", fetchMock);
    const { getZohoInvoicePdf } = await import("./books");

    await expect(getZohoInvoicePdf("invoice-1")).resolves.toEqual(new TextEncoder().encode(pdf));
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/invoices/invoice-1");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("accept=pdf");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ headers: expect.objectContaining({ Accept: "application/pdf" }) });
  });

  it("rejects an invoice response that is not a PDF", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("<html>login</html>", { status: 200, headers: { "content-type": "text/html" } })));
    const { getZohoInvoicePdf } = await import("./books");
    await expect(getZohoInvoicePdf("invoice-1")).rejects.toThrow("invalid invoice PDF");
  });
});

describe("createZohoContact", () => {
  it("creates an individual customer with a primary contact person carrying the CRM details", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(envelope({ code: 0, contact: { contact_id: "c-1", contact_name: "Jia Jun" } }));
    vi.stubGlobal("fetch", fetchMock);
    const { createZohoContact } = await import("./books");

    await expect(createZohoContact({ name: "Jia Jun", email: "jia@example.com", mobile: "91234567" })).resolves.toMatchObject({ contact_id: "c-1" });

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({ contact_name: "Jia Jun", contact_type: "customer", customer_sub_type: "individual" });
    expect(body.contact_persons).toEqual([{ first_name: "Jia Jun", email: "jia@example.com", mobile: "91234567", is_primary_contact: true }]);
    expect(body).not.toHaveProperty("email");
    expect(body).not.toHaveProperty("mobile");
  });

  it("omits the email key when the CRM has none", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(envelope({ code: 0, contact: { contact_id: "c-1", contact_name: "Jia Jun" } }));
    vi.stubGlobal("fetch", fetchMock);
    const { createZohoContact } = await import("./books");

    await createZohoContact({ name: "Jia Jun", email: null, mobile: "91234567" });

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.contact_persons).toEqual([{ first_name: "Jia Jun", mobile: "91234567", is_primary_contact: true }]);
  });

  it("creates a primary person with only the name when no details exist", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(envelope({ code: 0, contact: { contact_id: "c-1", contact_name: "Jia Jun" } }));
    vi.stubGlobal("fetch", fetchMock);
    const { createZohoContact } = await import("./books");

    await createZohoContact({ name: "Jia Jun", email: "", mobile: null });

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.contact_persons).toEqual([{ first_name: "Jia Jun", is_primary_contact: true }]);
  });

  it("never retries a non-idempotent contact POST", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(envelope({ code: 1, message: "uncertain" }, 500));
    vi.stubGlobal("fetch", fetchMock);
    const { createZohoContact } = await import("./books");

    await expect(createZohoContact({ name: "Jia Jun", email: null, mobile: null })).rejects.toThrow("uncertain");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
