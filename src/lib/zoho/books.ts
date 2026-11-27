import "server-only";

import { UserFacingError } from "@/lib/user-facing-error";

import { getZohoAccessContext, getZohoConnectionSummary } from "./connection";
import { ZohoEstimateConversionRejectedError } from "./conversion-error";

type ZohoEnvelope = { code?: number; message?: string; [key: string]: unknown };

export type ZohoContactPerson = {
  contact_person_id?: string;
  salutation?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  mobile?: string;
  is_primary_contact?: boolean;
};

export type ZohoContact = {
  contact_id: string;
  contact_name: string;
  company_name?: string;
  email?: string;
  phone?: string;
  mobile?: string;
  status?: string;
  contact_type?: string;
  primary_contact_id?: string;
  contact_persons?: ZohoContactPerson[];
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
  sub_total?: number;
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
  line_items?: Array<{ item_id?: string; name?: string; description?: string; quantity: number; rate: number; discount?: number | string; discount_amount?: number; tax_id?: string; tax_percentage?: number; item_total?: number }>;
  discount?: number | string;
  discount_type?: string;
  is_inclusive_tax?: boolean;
  tax_total?: number;
  taxes?: Array<{ tax_id?: string; tax_name?: string; tax_percentage?: number; tax_amount?: number }>;
  adjustment?: number;
  shipping_charge?: number;
  custom_fields?: Array<{ customfield_id?: string; api_name?: string; value?: unknown; label?: string }>;
};

export type ZohoInvoice = {
  reference_number?: string;
  write_off_amount?: number;
  tax_amount_withheld?: number;
  ach_payment_initiated?: boolean;
  invoice_id: string;
  invoice_number?: string;
  invoiced_estimate_id?: string;
  line_items?: ZohoEstimate["line_items"];
  discount?: number | string;
  discount_type?: string;
  is_inclusive_tax?: boolean;
  tax_total?: number;
  taxes?: ZohoEstimate["taxes"];
  adjustment?: number;
  shipping_charge?: number;
  payment_made?: number;
  balance?: number;
  credits_applied?: number;
  created_time?: string;
  last_modified_time?: string;
  customer_id?: string;
  currency_code?: string;
  total?: number;
  status?: string;
};

export type ZohoCustomerPayment = {
  payment_id: string;
  payment_number?: string;
  customer_id?: string;
  payment_mode?: string;
  amount?: number;
  date?: string;
  reference_number?: string;
  account_id?: string;
  invoice_number?: string;
  invoices?: Array<{ invoice_id?: string; invoice_number?: string; amount_applied?: number; balance_amount?: number }>;
};

const PAYMENTS_SCOPE_MESSAGE = "Zoho Books needs permission to record customer payments. Nothing was sent to Zoho. To fix: an admin opens Integrations in the top menu, clicks Reconnect Zoho Books, signs in to Zoho and clicks Accept. Then try again.";
const INVOICE_NUMBERING_SCOPE_MESSAGE = "Zoho Books needs permission to number invoices. Nothing was sent to Zoho. To fix: an admin opens Integrations in the top menu, clicks Reconnect Zoho Books, signs in to Zoho and clicks Accept. Then try again.";

// Missing-scope failures are UserFacingError so the reconnect instruction
// survives the Server Action boundary instead of being genericised.
function requireScope(context: Awaited<ReturnType<typeof getZohoAccessContext>>, scope: string, message: string) {
  if (!context.requestedScopes.includes(scope)) {
    throw new UserFacingError(message);
  }
}

export function getZohoDepositPaymentConfig() {
  const accountId = process.env.ZOHO_PAYMENT_ACCOUNT_ID?.trim();
  if (!accountId || !/^\d+$/.test(accountId)) throw new Error("ZOHO_PAYMENT_ACCOUNT_ID is not configured");
  return { accountId, paymentMode: "PayNow" };
}

export async function assertZohoCustomerPaymentsReady(): Promise<void> {
  const context = await getZohoAccessContext(false, true);
  requireScope(context, "ZohoBooks.customerpayments.READ", PAYMENTS_SCOPE_MESSAGE);
  requireScope(context, "ZohoBooks.customerpayments.CREATE", PAYMENTS_SCOPE_MESSAGE);
  getZohoDepositPaymentConfig();
}

// Invoice numbering was added to the consent after some organizations were
// already connected; those tokens reject every PUT on /invoices. Checking the
// recorded scopes first keeps the failure a clear reconnect instruction.
export async function assertZohoInvoiceNumberingReady(): Promise<void> {
  const context = await getZohoAccessContext();
  requireScope(context, "ZohoBooks.invoices.UPDATE", INVOICE_NUMBERING_SCOPE_MESSAGE);
}

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

async function requestRaw<T extends ZohoEnvelope>(path: string, init: RequestInit = {}, attempt = 0, forceRefresh = false, noRetry = false): Promise<T> {
  const context = await getZohoAccessContext(forceRefresh, path.startsWith("/invoices") || path.startsWith("/customerpayments") || path.startsWith("/contacts"));
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
  if (!noRetry && (init.method ?? "GET").toUpperCase() !== "POST" && response.status === 401 && attempt === 0) {
    return requestRaw<T>(path, init, 1, true);
  }
  const json = await response.json() as T;
  const method = (init.method ?? "GET").toUpperCase();
  // POST may have succeeded even when its response was lost. Retrying contact
  // or invoice creation would duplicate financial/customer records. Those
  // workflows reconcile explicitly instead.
  const retryableMethod = method === "GET" || method === "PUT";
  const retryable = retryableMethod && (response.status === 429 || response.status >= 500 || RETRYABLE_CODES.has(json.code ?? 0));
  if (!noRetry && retryable && attempt < 3) {
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

export async function findZohoEstimateByNumber(estimateNumber: string): Promise<ZohoEstimate[]> {
  const query = new URLSearchParams({ estimate_number: estimateNumber.trim(), per_page: "200" });
  const json = await request<ZohoEnvelope & { estimates?: ZohoEstimate[] }>(`/estimates?${query}`);
  return (json.estimates ?? []).filter((estimate) => estimate.estimate_number === estimateNumber.trim());
}

export async function findZohoInvoicesByNumber(invoiceNumber: string): Promise<ZohoInvoice[]> {
  const query = new URLSearchParams({ invoice_number: invoiceNumber.trim(), per_page: "200" });
  const json = await request<ZohoEnvelope & { invoices?: ZohoInvoice[] }>(`/invoices?${query}`);
  return (json.invoices ?? []).filter((invoice) => invoice.invoice_number === invoiceNumber.trim());
}

export async function getZohoContact(id: string): Promise<ZohoContact> {
  const json = await request<ZohoEnvelope & { contact?: ZohoContact }>(`/contacts/${encodeURIComponent(id)}`);
  if (!json.contact) throw new Error("Zoho customer not found");
  return json.contact;
}

export async function createZohoContact(input: { name: string; salutation?: string | null; email: string | null; mobile: string | null; address: string | null }): Promise<ZohoContact> {
  const email = input.email?.trim();
  const mobile = input.mobile?.trim();
  const address = input.address?.trim();
  const salutation = input.salutation?.trim();
  // Zoho derives a contact's email/phone fields from its primary contact
  // person — top-level email/mobile keys are silently dropped — and defaults
  // the subtype to business, so both must be sent explicitly. Estimates take
  // Bill To / Ship To from the contact's billing/shipping address, so the
  // order's site address is sent verbatim on both.
  const person = {
    first_name: input.name,
    ...(salutation ? { salutation } : {}),
    ...(email ? { email } : {}),
    ...(mobile ? { mobile } : {}),
    is_primary_contact: true,
  };
  const json = await request<ZohoEnvelope & { contact?: ZohoContact }>("/contacts", {
    method: "POST",
    body: JSON.stringify({
      contact_name: input.name,
      contact_type: "customer",
      customer_sub_type: "individual",
      contact_persons: [person],
      ...(address ? { billing_address: { address }, shipping_address: { address } } : {}),
    }),
  });
  if (!json.contact) throw new Error("Zoho Books did not return the new customer");
  return json.contact;
}

const CONTACTS_UPDATE_SCOPE_MESSAGE = "Zoho Books needs permission to update customers. The title was saved in the CRM but not sent to Zoho. To fix: an admin opens Integrations in the top menu, clicks Reconnect Zoho Books, signs in to Zoho and clicks Accept, then retries the sync.";

/**
 * Push a title change onto the linked customer's PRIMARY contact person.
 *
 * Fetch-before-update: Zoho replaces the person wholesale, so the stored
 * record is re-read and merged — first/last name, email and every other field
 * the CRM does not own ride through untouched. Clearing the title sends "".
 */
export async function updateZohoPrimaryContactSalutation(input: { contactId: string; salutation: string | null }): Promise<void> {
  const context = await getZohoAccessContext(true, true);
  requireScope(context, "ZohoBooks.contacts.UPDATE", CONTACTS_UPDATE_SCOPE_MESSAGE);
  const contact = await getZohoContact(input.contactId);
  const persons = contact.contact_persons ?? [];
  // Only an explicitly-flagged primary may be written. Falling back to the
  // first listed person would edit an arbitrary contact — an absent or
  // ambiguous primary is a retryable failure, not a guess.
  const flagged = persons.filter((person) => person.is_primary_contact);
  const primary = flagged.length === 1
    ? flagged[0]
    : contact.primary_contact_id
      ? persons.find((person) => person.contact_person_id === contact.primary_contact_id)
      : undefined;
  if (!primary?.contact_person_id) {
    throw new Error(
      flagged.length > 1
        ? "The linked Zoho customer lists more than one primary contact person. Set a single primary in Zoho Books, then retry."
        : "The linked Zoho customer has no identifiable primary contact person. Check the contact in Zoho Books, then retry.",
    );
  }
  // Documented endpoint: PUT /contacts/contactpersons/{contact_person_id}.
  // contact_id and first_name are required; every stored field rides through
  // so the partial update cannot blank what the CRM does not own.
  const json = await request<ZohoEnvelope & { contact_person?: ZohoContactPerson }>(
    `/contacts/contactpersons/${encodeURIComponent(primary.contact_person_id)}`,
    {
      method: "PUT",
      body: JSON.stringify({
        ...primary,
        contact_id: input.contactId,
        first_name: primary.first_name ?? contact.contact_name,
        salutation: input.salutation?.trim() ?? "",
      }),
    },
  );
  if (!json.contact_person) {
    throw new Error("Zoho Books did not return the updated contact person");
  }
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

// Zoho's documented success for this endpoint is the bare envelope
// {code:0,message:"The invoices have been created."} — no invoice object — so
// a missing inline id is an acknowledgement, not a failure: return null and
// let the caller reconcile through the estimate's authoritative invoice_ids.
// A per-estimate refusal is reported only inside `data` as a numeric nonzero
// code under the same code:0 envelope; it is checked before any inline
// invoice so an error mixed with an invoice object can never bypass
// reconciliation.
export async function convertZohoEstimateToInvoice(id: string): Promise<{ invoice_id: string; invoice_number?: string } | null> {
  const json = await request<ZohoEnvelope & { invoices?: Array<{ invoice_id: string; invoice_number?: string }>; invoice?: { invoice_id: string; invoice_number?: string }; data?: unknown }>(`/invoices/fromestimates?estimate_ids=${encodeURIComponent(id)}`, { method: "POST" });
  const rejection = conversionRejectionCode(json.data);
  if (rejection !== null) throw new ZohoEstimateConversionRejectedError(rejection);
  const invoice = json.invoice ?? json.invoices?.[0];
  return invoice?.invoice_id ? invoice : null;
}

// Only a plain-object `data` carrying a numeric nonzero code is treated as a
// rejection; anything looser (string codes, arrays, missing data) stays on
// the conservative uncertain path.
function conversionRejectionCode(data: unknown): number | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const code = (data as { code?: unknown }).code;
  return typeof code === "number" && Number.isFinite(code) && code !== 0 ? code : null;
}

export async function getZohoInvoice(id: string): Promise<ZohoInvoice> {
  const json = await request<ZohoEnvelope & { invoice?: ZohoInvoice }>(`/invoices/${encodeURIComponent(id)}`);
  if (!json.invoice) throw new Error("Zoho invoice not found");
  return json.invoice;
}

// A commercial PUT must never retry blindly: payment activity can change
// between attempts. The caller re-reads and reconciles any uncertain response.
export async function updateZohoInvoiceCommercial(id: string, lines: Array<{ item_id?: string; name: string; description: string; quantity: number; rate: number; discount: string }>, customerId: string): Promise<void> {
  const context = await getZohoAccessContext(false, true);
  requireScope(context, "ZohoBooks.invoices.UPDATE", "Reconnect Zoho Books with invoice update permission.");
  const operation = requestTail.then(() => requestRaw<ZohoEnvelope>(`/invoices/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ customer_id: customerId, line_items: lines, discount_type: "item_level", is_inclusive_tax: false }) }, 0, false, true));
  requestTail = operation.catch(() => undefined);
  await operation;
}

// Zoho numbers a converted invoice on its own sequence; the CRM renames it to
// the quotation's suffix (QT-677816 → INV-677816) so the documents tally.
// ignore_auto_number_generation=true is what makes invoice_number settable at
// all. PUT is retry-safe in `request`, so a lost response retries cleanly.
export async function renameZohoInvoice(id: string, invoiceNumber: string): Promise<ZohoInvoice> {
  await assertZohoInvoiceNumberingReady();
  const query = new URLSearchParams({ ignore_auto_number_generation: "true" });
  const json = await request<ZohoEnvelope & { invoice?: ZohoInvoice }>(`/invoices/${encodeURIComponent(id)}?${query}`, {
    method: "PUT",
    body: JSON.stringify({ invoice_number: invoiceNumber }),
  });
  if (!json.invoice) throw new Error("Zoho Books did not return the renumbered invoice");
  return json.invoice;
}

export async function listZohoCustomerPayments(customerId: string): Promise<ZohoCustomerPayment[]> {
  const context = await getZohoAccessContext(false, true);
  requireScope(context, "ZohoBooks.customerpayments.READ", PAYMENTS_SCOPE_MESSAGE);
  const payments: ZohoCustomerPayment[] = [];
  let page = 1;
  let hasMore = true;
  while (hasMore && page <= 20) {
    const query = new URLSearchParams({ customer_id: customerId, page: String(page), per_page: "200" });
    const json = await request<ZohoEnvelope & { customer_payments?: ZohoCustomerPayment[]; page_context?: { has_more_page?: boolean } }>(`/customerpayments?${query}`);
    payments.push(...(json.customer_payments ?? []));
    hasMore = Boolean(json.page_context?.has_more_page);
    page += 1;
  }
  if (hasMore) throw new Error("Zoho customer payment lookup exceeded the safe page limit");
  return payments;
}

export async function getZohoCustomerPayment(id: string): Promise<ZohoCustomerPayment> {
  const context = await getZohoAccessContext(false, true);
  requireScope(context, "ZohoBooks.customerpayments.READ", PAYMENTS_SCOPE_MESSAGE);
  const json = await request<ZohoEnvelope & { payment?: ZohoCustomerPayment }>(`/customerpayments/${encodeURIComponent(id)}`);
  if (!json.payment) throw new Error("Zoho customer payment not found");
  return json.payment;
}

export async function createZohoCustomerPayment(input: {
  customerId: string;
  invoiceId: string;
  amountCents: number;
  date: string;
  referenceNumber: string;
  accountId: string;
  paymentMode: string;
}): Promise<ZohoCustomerPayment> {
  const context = await getZohoAccessContext(false, true);
  requireScope(context, "ZohoBooks.customerpayments.CREATE", PAYMENTS_SCOPE_MESSAGE);
  const amount = input.amountCents / 100;
  const json = await request<ZohoEnvelope & { payment?: ZohoCustomerPayment }>("/customerpayments", {
    method: "POST",
    body: JSON.stringify({
      customer_id: input.customerId,
      payment_mode: input.paymentMode,
      amount,
      date: input.date,
      reference_number: input.referenceNumber,
      description: `Deposit received for ${input.referenceNumber}`,
      account_id: input.accountId,
      invoices: [{ invoice_id: input.invoiceId, amount_applied: amount }],
    }),
  });
  if (!json.payment?.payment_id) throw new Error("Zoho Books did not return the customer payment it created");
  return json.payment;
}

export async function getZohoInvoicePdf(id: string): Promise<Uint8Array> {
  const context = await getZohoAccessContext();
  const url = new URL(`${context.apiBaseUrl}/invoices/${encodeURIComponent(id)}`);
  url.searchParams.set("organization_id", context.organizationId);
  url.searchParams.set("accept", "pdf");
  const response = await fetch(url, {
    headers: {
      Authorization: `Zoho-oauthtoken ${context.accessToken}`,
      Accept: "application/pdf",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Could not download the Zoho invoice PDF (${response.status})`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const type = response.headers.get("content-type")?.toLowerCase() ?? "";
  const magic = new TextDecoder().decode(bytes.slice(0, 5));
  if (!type.includes("application/pdf") || bytes.length < 100 || magic !== "%PDF-") throw new Error("Zoho returned an invalid invoice PDF");
  return bytes;
}

// Invoice configuration deliberately does not depend on estimate templates/fields.
export async function getZohoInvoiceBinding() {
  const context = await getZohoAccessContext(false, true);
  requireScope(context, "ZohoBooks.invoices.READ", "Reconnect Zoho Books with invoice read permission.");
  return { organizationId: context.organizationId };
}
export async function listZohoCustomerInvoices(customerId: string): Promise<ZohoInvoice[]> {
  await getZohoInvoiceBinding();
  const invoices: ZohoInvoice[] = [];
  for (let page = 1; page <= 20; page++) {
    const query = new URLSearchParams({customer_id:customerId,page:String(page),per_page:"200"});
    const response = await request<ZohoEnvelope & { invoices?: ZohoInvoice[]; page_context?: { has_more_page?: boolean } }>(`/invoices?${query}`);
    if (!Array.isArray(response.invoices) || typeof response.page_context?.has_more_page !== "boolean") throw new Error("Invoice search was incomplete. Retry before creating an invoice.");
    for (const summary of response.invoices) {
      const invoice = await getZohoInvoice(summary.invoice_id);
      if (invoice.invoice_id !== summary.invoice_id || invoice.customer_id !== customerId) throw new Error("Invoice search identity mismatch");
      invoices.push(invoice);
    }
    if (!response.page_context.has_more_page) return invoices;
  }
  throw new Error("Invoice search exceeded the safe page limit");
}
export async function createZohoOrderInvoice(input: { customerId: string; orderId: string; lines: Parameters<typeof updateZohoInvoiceCommercial>[1]; date: string }): Promise<ZohoInvoice> {
  const context = await getZohoAccessContext(false, true);
  requireScope(context,"ZohoBooks.invoices.CREATE","Reconnect Zoho Books with invoice create permission.");
  const operation=requestTail.then(()=>requestRaw<ZohoEnvelope & {invoice?:ZohoInvoice}>("/invoices",{method:"POST",body:JSON.stringify({customer_id:input.customerId,reference_number:`CRM-ORDER-${input.orderId}`,date:input.date,line_items:input.lines,discount_type:"item_level",is_inclusive_tax:false})},0,false,true));
  requestTail=operation.catch(()=>undefined);
  const response=await operation;
  if(!response.invoice?.invoice_id) throw new Error("Invoice creation acknowledgement did not contain an ID. Reconcile before retrying.");
  return response.invoice;
}
