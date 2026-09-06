import "server-only";

import { getZohoAccessContext, getZohoConnectionSummary } from "./connection";

type ZohoEnvelope = { code?: number; message?: string; [key: string]: unknown };

export type ZohoContact = {
  contact_id: string;
  contact_name: string;
  company_name?: string;
  email?: string;
  phone?: string;
  mobile?: string;
  status?: string;
  contact_type?: string;
};

export type ZohoItem = {
  item_id: string;
  name: string;
  description?: string;
  rate: number;
  status?: string;
};

export type ZohoEstimate = {
  estimate_id: string;
  estimate_number: string;
  status: string;
  total: number;
  last_modified_time?: string;
  invoice_ids?: string[];
  customer_id?: string;
  reference_number?: string;
  date?: string;
  expiry_date?: string;
  template_id?: string;
  currency_code?: string;
  notes?: string;
  terms?: string;
  line_items?: Array<{ item_id?: string; name?: string; description?: string; quantity: number; rate: number; discount?: number }>;
  custom_fields?: Array<{ customfield_id?: string; api_name?: string; value?: unknown; label?: string }>;
};

export async function getZohoBooksBinding() {
  const context = await getZohoAccessContext();
  if (!context.crmKeyApiName || !context.crmKeyFieldId || !context.estimateTemplateId) {
    throw new Error("Zoho Books organization settings are not verified. Ask an admin to reconnect it under Integrations.");
  }
  return {
    crmKeyApiName: context.crmKeyApiName,
    crmKeyFieldId: context.crmKeyFieldId,
    estimateTemplateId: context.estimateTemplateId,
  };
}

export async function isZohoBooksConfigured(): Promise<boolean> {
  const summary = await getZohoConnectionSummary();
  return Boolean(summary.connection?.status === "connected" && summary.connection.estimate_crm_key_api_name && summary.connection.estimate_crm_key_id && summary.connection.estimate_template_id);
}

const RETRYABLE_CODES = new Set([1070]);

let requestTail: Promise<unknown> = Promise.resolve();

async function requestRaw<T extends ZohoEnvelope>(path: string, init: RequestInit = {}, attempt = 0, forceRefresh = false): Promise<T> {
  const context = await getZohoAccessContext(forceRefresh);
  const url = new URL(`${context.apiBaseUrl}${path}`);
  url.searchParams.set("organization_id", context.organizationId);
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Zoho-oauthtoken ${context.accessToken}`,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
    cache: "no-store",
    signal: init.signal ?? AbortSignal.timeout(15_000),
  });
  if (response.status === 401 && attempt === 0) {
    return requestRaw<T>(path, init, 1, true);
  }
  const json = await response.json() as T;
  const method = (init.method ?? "GET").toUpperCase();
  // POST may have succeeded even when its response was lost. Retrying contact
  // or invoice creation would duplicate financial/customer records. Those
  // workflows reconcile explicitly instead.
  const retryableMethod = method === "GET" || method === "PUT";
  const retryable = retryableMethod && (response.status === 429 || response.status >= 500 || RETRYABLE_CODES.has(json.code ?? 0));
  if (retryable && attempt < 3) {
    await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** attempt));
    return requestRaw<T>(path, init, attempt + 1, false);
  }
  if (!response.ok || (typeof json.code === "number" && json.code !== 0)) {
    throw new Error(json.message || `Zoho Books request failed (${response.status})`);
  }
  return json;
}

function request<T extends ZohoEnvelope>(path: string, init: RequestInit = {}): Promise<T> {
  const operation = requestTail.then(() => requestRaw<T>(path, init));
  requestTail = operation.catch(() => undefined);
  return operation;
}

export async function listZohoItems(): Promise<ZohoItem[]> {
  const json = await request<ZohoEnvelope & { items?: ZohoItem[] }>("/items?filter_by=Status.Active&per_page=200");
  return json.items ?? [];
}

export async function listZohoContacts(searchText: string): Promise<ZohoContact[]> {
  const query = new URLSearchParams({ contact_type: "customer", filter_by: "Status.Active", per_page: "200" });
  if (searchText.trim()) query.set("search_text", searchText.trim());
  const json = await request<ZohoEnvelope & { contacts?: ZohoContact[] }>(`/contacts?${query}`);
  return json.contacts ?? [];
}

export async function getZohoContact(id: string): Promise<ZohoContact> {
  const json = await request<ZohoEnvelope & { contact?: ZohoContact }>(`/contacts/${encodeURIComponent(id)}`);
  if (!json.contact) throw new Error("Zoho customer not found");
  return json.contact;
}

export async function createZohoContact(input: { name: string; email: string | null; mobile: string | null }): Promise<ZohoContact> {
  const json = await request<ZohoEnvelope & { contact?: ZohoContact }>("/contacts", {
    method: "POST",
    body: JSON.stringify({ contact_name: input.name, contact_type: "customer", email: input.email ?? "", mobile: input.mobile ?? "" }),
  });
  if (!json.contact) throw new Error("Zoho Books did not return the new customer");
  return json.contact;
}

export async function findZohoEstimatesByCrmQuoteKey(crmQuoteKey: string): Promise<ZohoEstimate[]> {
  const binding = await getZohoBooksBinding();
  const matches: ZohoEstimate[] = [];
  let page = 1;
  let hasMore = true;
  while (hasMore && page <= 20) {
    // Zoho documents `custom_field` as an Estimate list filter, but this Books
    // organization returns code 101007 ("Invalid value passed for Status")
    // whenever that parameter is supplied. List each bounded page and inspect
    // the full records instead. This is slower, but it preserves the duplicate
    // prevention guarantee for a non-unique CRM Quote Key field.
    const query = new URLSearchParams({ page: String(page), per_page: "200" });
    const json = await request<ZohoEnvelope & {
      estimates?: ZohoEstimate[];
      page_context?: { has_more_page?: boolean };
    }>(`/estimates?${query}`);
    for (const summary of json.estimates ?? []) {
      const estimate = await getZohoEstimate(summary.estimate_id);
      const value = estimate.custom_fields?.find((field) =>
        field.customfield_id === binding.crmKeyFieldId || field.api_name === binding.crmKeyApiName || field.label === "CRM Quote Key")?.value;
      if (value === crmQuoteKey) matches.push(estimate);
    }
    hasMore = Boolean(json.page_context?.has_more_page);
    page += 1;
  }
  if (hasMore) throw new Error("Zoho quotation lookup exceeded the safe page limit");
  return matches;
}

async function reconcileCreatedEstimate(crmQuoteKey: string): Promise<ZohoEstimate | null> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** (attempt - 1)));
    const matches = await findZohoEstimatesByCrmQuoteKey(crmQuoteKey);
    if (matches.length > 1) throw new Error("Multiple Zoho quotations have the same CRM Quote Key; reconciliation is required");
    if (matches.length === 1) return matches[0];
  }
  return null;
}

export async function syncZohoEstimate(input: { crmQuoteKey: string; payload: Record<string, unknown>; estimateId?: string | null }): Promise<ZohoEstimate> {
  const context = await getZohoAccessContext();
  if (!context.crmKeyApiName || !context.crmKeyFieldId) throw new Error("The Zoho CRM Quote Key field is not verified");
  const customFieldId = context.crmKeyFieldId;
  const body = JSON.stringify({
    ...input.payload,
    custom_fields: [{ customfield_id: customFieldId, value: input.crmQuoteKey }],
  });

  let estimateId = input.estimateId ?? null;
  if (!estimateId) {
    const existing = await findZohoEstimatesByCrmQuoteKey(input.crmQuoteKey);
    if (existing.length > 1) throw new Error("Multiple Zoho quotations have the same CRM Quote Key; reconciliation is required");
    estimateId = existing[0]?.estimate_id ?? null;
  }

  if (estimateId) {
    const json = await request<ZohoEnvelope & { estimate?: ZohoEstimate }>(`/estimates/${encodeURIComponent(estimateId)}`, {
      method: "PUT",
      body,
    });
    if (!json.estimate) throw new Error("Zoho Books did not return the updated quotation");
    return json.estimate;
  }

  const capabilities = (await getZohoConnectionSummary()).connection?.verified_capabilities;
  const unique = Boolean(capabilities && typeof capabilities === "object" && !Array.isArray(capabilities) && capabilities.crmKeyUnique === true);
  if (unique) {
    const json = await request<ZohoEnvelope & { estimate?: ZohoEstimate }>("/estimates", {
      method: "PUT",
      headers: {
        "X-Unique-Identifier-Key": context.crmKeyApiName,
        "X-Unique-Identifier-Value": input.crmQuoteKey,
        "X-Upsert": "true",
      },
      body,
    });
    if (!json.estimate) throw new Error("Zoho Books did not return the upserted quotation");
    return json.estimate;
  }

  try {
    const json = await request<ZohoEnvelope & { estimate?: ZohoEstimate }>("/estimates", { method: "POST", body });
    if (!json.estimate) throw new Error("Zoho Books did not return the new quotation");
    return json.estimate;
  } catch (error) {
    const reconciled = await reconcileCreatedEstimate(input.crmQuoteKey);
    if (reconciled) return reconciled;
    const reason = error instanceof Error ? error.message : "unknown Zoho error";
    throw new Error(`Zoho quotation creation could not be confirmed (${reason}). Retry later; the CRM Quote Key will be checked before another create.`);
  }
}

export async function getZohoEstimate(id: string): Promise<ZohoEstimate> {
  const json = await request<ZohoEnvelope & { estimate?: ZohoEstimate }>(`/estimates/${encodeURIComponent(id)}`);
  if (!json.estimate) throw new Error("Zoho quotation not found");
  return json.estimate;
}

export async function getZohoEstimatePdf(id: string): Promise<Uint8Array> {
  const context = await getZohoAccessContext();
  const url = new URL(`${context.apiBaseUrl}/estimates/pdf`);
  url.searchParams.set("organization_id", context.organizationId);
  url.searchParams.set("estimate_ids", id);
  const response = await fetch(url, { headers: { Authorization: `Zoho-oauthtoken ${context.accessToken}` }, cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Could not download the Zoho quotation PDF (${response.status})`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const type = response.headers.get("content-type")?.toLowerCase() ?? "";
  const magic = new TextDecoder().decode(bytes.slice(0, 5));
  if (!type.includes("application/pdf") || bytes.length < 100 || magic !== "%PDF-") throw new Error("Zoho returned an invalid quotation PDF");
  return bytes;
}

export async function markZohoEstimateSent(id: string): Promise<void> {
  await request(`/estimates/${encodeURIComponent(id)}/status/sent`, { method: "POST" });
}

export async function convertZohoEstimateToInvoice(id: string): Promise<{ invoice_id: string; invoice_number?: string }> {
  const json = await request<ZohoEnvelope & { invoices?: Array<{ invoice_id: string; invoice_number?: string }>; invoice?: { invoice_id: string; invoice_number?: string } }>(`/invoices/fromestimates?estimate_ids=${encodeURIComponent(id)}`, { method: "POST" });
  const invoice = json.invoice ?? json.invoices?.[0];
  if (!invoice?.invoice_id) throw new Error("Zoho Books did not return the invoice it created");
  return invoice;
}

export async function getZohoInvoice(id: string): Promise<{ invoice_id: string; invoice_number?: string; invoiced_estimate_id?: string; customer_id?: string; currency_code?: string; total?: number; status?: string }> {
  const json = await request<ZohoEnvelope & { invoice?: { invoice_id: string; invoice_number?: string; invoiced_estimate_id?: string; customer_id?: string; currency_code?: string; total?: number; status?: string } }>(`/invoices/${encodeURIComponent(id)}`);
  if (!json.invoice) throw new Error("Zoho invoice not found");
  return json.invoice;
}
