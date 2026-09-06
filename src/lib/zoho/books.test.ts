import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./connection", () => ({
  getZohoAccessContext: vi.fn(async () => ({ accessToken: "token", organizationId: "org", apiBaseUrl: "https://www.zohoapis.com/books/v3", crmKeyApiName: "cf_crm_quote_key", crmKeyFieldId: "field", estimateTemplateId: "template" })),
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
});
