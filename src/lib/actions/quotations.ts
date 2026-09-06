"use server";

import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";

import { requireRole, requireSession } from "@/lib/auth/require-role";
import { db } from "@/lib/db/kysely";
import type { Json, OrderQuotations } from "@/lib/db/schema";
import { sql, type Selectable } from "kysely";
import { leadMilestoneForOrderStatus } from "@/lib/status-flow";
import { adminClient } from "@/lib/supabase/admin";
import {
  confirmZohoCustomerSchema,
  quotationIdSchema,
  saveQuotationSchema,
  sendQuotationSchema,
  quotationLineSchema,
  type QuotationLineInput,
} from "@/lib/validation/quotation";
import {
  createZohoContact,
  getZohoContact,
  getZohoEstimate,
  getZohoEstimatePdf,
  getZohoInvoice,
  getZohoBooksBinding,
  findZohoEstimatesByCrmQuoteKey,
  listZohoContacts,
  listZohoItems,
  markZohoEstimateSent,
  syncZohoEstimate,
  convertZohoEstimateToInvoice,
} from "@/lib/zoho/books";
import { quotePayloadHash } from "@/lib/quotations/hash";
import { quotationDateOnly, quotationTotalCents, toZohoEstimatePayload } from "@/lib/quotations/model";

const BUCKET = "customer-quotations";
const SIGNED_URL_SECONDS = 300;

async function authorizedOrder(orderId: string, write: boolean) {
  const session = await requireSession();
  const order = await db.selectFrom("orders")
    .innerJoin("customers", "customers.id", "orders.customer_id")
    .leftJoin("profiles", "profiles.id", "orders.consultant_id")
    .select([
      "orders.id", "orders.display_id", "orders.order_reference", "orders.current_status", "orders.consultant_id",
      "customers.id as customer_id", "customers.name as customer_name", "customers.email as customer_email", "customers.mobile as customer_mobile",
      "profiles.full_name as consultant_name",
    ])
    .where("orders.id", "=", orderId).executeTakeFirst();
  if (!order) throw new Error("Order not found");
  const isOwner = session.profile.role === "consultant" && order.consultant_id === session.user.id;
  const canWrite = session.profile.role === "admin" || isOwner;
  const canRead = canWrite || session.profile.role === "ops";
  if ((write && !canWrite) || (!write && !canRead)) throw new Error("Forbidden");
  return { session, order };
}

export async function getZohoQuotationOptions(orderId: string) {
  const { order } = await authorizedOrder(orderId, false);
  const link = await db.selectFrom("customer_zoho_links").selectAll().where("customer_id", "=", order.customer_id).executeTakeFirst();
  // This Zoho organisation has returned concurrency code 1070 under parallel
  // reads, so keep this small POC sequence deliberately serial.
  const items = await listZohoItems();
  const candidates = link ? [] : await listZohoContacts(order.customer_name);
  const linkedContact = link ? await getZohoContact(link.zoho_contact_id) : null;
  return {
    items: items.map((item) => ({ id: item.item_id, name: item.name, description: item.description ?? "", rateCents: Math.round(Number(item.rate) * 100) })),
    candidates: candidates.map((contact) => ({ id: contact.contact_id, name: contact.contact_name, company: contact.company_name ?? "", email: contact.email ?? "", phone: contact.mobile || contact.phone || "" })),
    linkedContactId: link?.zoho_contact_id ?? null,
    linkedContact: linkedContact ? { id: linkedContact.contact_id, name: linkedContact.contact_name, email: linkedContact.email ?? "", phone: linkedContact.mobile || linkedContact.phone || "" } : null,
  };
}

export async function searchZohoCustomers(orderId: string, query: string) {
  await authorizedOrder(orderId, false);
  if (query.trim().length < 2) throw new Error("Enter at least two characters");
  const contacts = await listZohoContacts(query.trim());
  return contacts.map((contact) => ({ id: contact.contact_id, name: contact.contact_name, company: contact.company_name ?? "", email: contact.email ?? "", phone: contact.mobile || contact.phone || "" }));
}

export async function confirmZohoCustomer(input: unknown) {
  const parsed = confirmZohoCustomerSchema.parse(input);
  const { session, order } = await authorizedOrder(parsed.orderId, true);
  const existingEstimate = await db.selectFrom("order_quotations").select("zoho_estimate_id").where("order_id", "=", parsed.orderId).where("superseded_at", "is", null).executeTakeFirst();
  if (existingEstimate?.zoho_estimate_id) throw new Error("The Zoho customer cannot be changed after an official draft exists");
  const contact = await getZohoContact(parsed.zohoContactId);
  if (contact.status && contact.status !== "active") throw new Error("That Zoho customer is not active");
  if (contact.contact_type !== "customer") throw new Error("Only a Zoho customer can be linked to an order");
  await db.insertInto("customer_zoho_links").values({
    customer_id: order.customer_id, zoho_contact_id: contact.contact_id, confirmed_by: session.user.id,
  }).onConflict((conflict) => conflict.column("customer_id").doUpdateSet({
    zoho_contact_id: contact.contact_id, confirmed_by: session.user.id, confirmed_at: new Date(),
  })).execute();
  revalidatePath(`/orders/${parsed.orderId}`);
}

export async function createAndConfirmZohoCustomer(orderId: string) {
  const { session, order } = await authorizedOrder(orderId, true);
  const existingEstimate = await db.selectFrom("order_quotations").select("zoho_estimate_id").where("order_id", "=", orderId).where("superseded_at", "is", null).executeTakeFirst();
  if (existingEstimate?.zoho_estimate_id) throw new Error("The Zoho customer cannot be changed after an official draft exists");
  let contact;
  try {
    contact = await createZohoContact({ name: order.customer_name, email: order.customer_email, mobile: order.customer_mobile });
  } catch (error) {
    // Never blindly retry a contact POST: Zoho may have committed it before a
    // response was lost. A refresh will surface the candidate for confirmation.
    throw new Error(`${error instanceof Error ? error.message : "Zoho customer creation was uncertain"}. Refresh and check for the customer before trying again.`);
  }
  await db.insertInto("customer_zoho_links").values({
    customer_id: order.customer_id, zoho_contact_id: contact.contact_id, confirmed_by: session.user.id,
  }).onConflict((conflict) => conflict.column("customer_id").doUpdateSet({
    zoho_contact_id: contact.contact_id, confirmed_by: session.user.id, confirmed_at: new Date(),
  })).execute();
  revalidatePath(`/orders/${orderId}`);
  return { id: contact.contact_id, name: contact.contact_name };
}

export async function saveQuotation(input: unknown): Promise<{ id: string }> {
  const parsed = saveQuotationSchema.parse(input);
  const { session, order } = await authorizedOrder(parsed.orderId, true);
  if (order.current_status !== "order_recorded" && order.current_status !== "quotation_sent") throw new Error("Quotations can only be edited during the quotation stage");
  const total = quotationTotalCents(parsed.lines);
  const result = await db.transaction().execute(async (trx) => {
    const current = await trx.selectFrom("order_quotations").selectAll()
      .where("order_id", "=", parsed.orderId).where("superseded_at", "is", null).forUpdate().executeTakeFirst();
    if (current?.status === "sent") throw new Error("Create a revised quotation before editing the sent version");
    if (current?.status === "syncing" || current?.status === "sending") throw new Error("This quotation is already being processed. Wait and refresh.");
    if (parsed.quotationId && current?.id !== parsed.quotationId) throw new Error("The current quotation changed. Refresh and try again.");
    if (current && parsed.expectedUpdatedAt && new Date(current.updated_at).toISOString() !== parsed.expectedUpdatedAt) {
      throw new Error("This quotation was edited elsewhere. Refresh before saving.");
    }
    const values = {
      issue_date: parsed.issueDate, expiry_date: parsed.expiryDate, lines: JSON.stringify(parsed.lines) as Json,
      quoted_total_cents: total, customer_message: parsed.customerMessage, notes: parsed.notes || null,
      terms: parsed.terms || null, status: "local_draft" as const, sync_error: null, updated_by: session.user.id,
    };
    if (current) {
      await trx.updateTable("order_quotations").set(values).where("id", "=", current.id).execute();
      return { id: current.id };
    }
    const id = randomUUID();
    await trx.insertInto("order_quotations").values({
      id, order_id: parsed.orderId, revision: 1, crm_quote_key: `dw:${parsed.orderId}:v1:${id}`,
      ...values, created_by: session.user.id,
    }).execute();
    return { id };
  });
  revalidatePath(`/orders/${parsed.orderId}`);
  return result;
}

function linesOf(row: Pick<Selectable<OrderQuotations>, "lines">): QuotationLineInput[] {
  return row.lines as unknown as QuotationLineInput[];
}

function comparableEstimate(value: Record<string, unknown>) {
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

async function crmKeyOf(estimate: { custom_fields?: Array<{ customfield_id?: string; api_name?: string; value?: unknown; label?: string }> }): Promise<unknown> {
  const binding = await getZohoBooksBinding();
  return estimate.custom_fields?.find((field) => field.customfield_id === binding.crmKeyFieldId || field.api_name === binding.crmKeyApiName || field.label === "CRM Quote Key")?.value;
}

async function storePdf(row: Pick<OrderQuotations, "id" | "order_id" | "zoho_estimate_id">) {
  if (!row.zoho_estimate_id) throw new Error("The quotation has not been created in Zoho");
  const bytes = await getZohoEstimatePdf(row.zoho_estimate_id);
  const hash = createHash("sha256").update(bytes).digest("hex");
  const path = `quotes/${row.order_id}/${row.id}/${hash}.pdf`;
  const { error } = await adminClient().storage.from(BUCKET).upload(path, bytes, { contentType: "application/pdf", upsert: false });
  if (error && !error.message.toLowerCase().includes("already exists")) throw new Error("Could not store the official quotation PDF");
  return { path, hash };
}

export async function syncQuotation(quotationId: string) {
  const id = quotationIdSchema.parse(quotationId);
  const seed = await db.selectFrom("order_quotations").selectAll().where("id", "=", id).executeTakeFirst();
  if (!seed) throw new Error("Quotation not found");
  const { order } = await authorizedOrder(seed.order_id, true);
  if (order.current_status !== "order_recorded" && order.current_status !== "quotation_sent") throw new Error("Quotations can only be synced during the quotation stage");
  if (seed.status === "sent" || seed.status === "superseded") throw new Error("A sent quotation cannot be changed");
  const link = await db.selectFrom("customer_zoho_links").select("zoho_contact_id").where("customer_id", "=", order.customer_id).executeTakeFirst();
  if (!link) throw new Error("Confirm the matching Zoho customer first");
  const binding = await getZohoBooksBinding();

  const payload = toZohoEstimatePayload({
    contactId: link.zoho_contact_id, referenceNumber: order.order_reference || order.display_id,
    issueDate: quotationDateOnly(seed.issue_date), expiryDate: quotationDateOnly(seed.expiry_date), lines: linesOf(seed),
    notes: seed.notes ?? "", terms: seed.terms ?? "", salespersonName: order.consultant_name,
    templateId: binding.estimateTemplateId,
  });
  const payloadHash = quotePayloadHash(payload);
  const claimToken = randomUUID();
  const claimed = await db.updateTable("order_quotations").set({ status: "syncing", sync_error: null, sync_claim_token: claimToken, sync_claimed_at: new Date() })
    .where("id", "=", id)
    // PostgreSQL keeps microseconds while the pg driver exposes Date values at
    // millisecond precision. Compare at the precision the client can preserve,
    // otherwise an unchanged quotation can never acquire its sync claim.
    .where(sql<boolean>`date_trunc('milliseconds', updated_at) = ${seed.updated_at}`)
    .where("status", "in", ["local_draft", "zoho_draft", "sync_failed"])
    .returningAll().executeTakeFirst();
  if (!claimed) throw new Error("Quotation changed or is already syncing. Refresh and try again.");

  try {
    if (seed.zoho_estimate_id && seed.zoho_last_modified_time) {
      const remote = await getZohoEstimate(seed.zoho_estimate_id);
      if (await crmKeyOf(remote) !== seed.crm_quote_key) throw new Error("The Zoho CRM Quote Key changed; reconciliation is required to avoid a duplicate");
      if (remote.status !== "draft") {
        throw new Error("Only a draft Zoho quotation can be updated. Create a revised quotation instead.");
      }
      const remoteEquivalent = quotePayloadHash(comparableEstimate(remote as unknown as Record<string, unknown>)) === quotePayloadHash(comparableEstimate(payload));
      if (remote.last_modified_time && remote.last_modified_time !== seed.zoho_last_modified_time && !remoteEquivalent) {
        await db.updateTable("order_quotations").set({ status: "conflict", sync_error: "This quotation was changed directly in Zoho Books. Reconcile it before overwriting.", sync_claim_token: null, sync_claimed_at: null }).where("id", "=", id).where("sync_claim_token", "=", claimToken).execute();
        throw new Error("This quotation was changed directly in Zoho Books. Reconcile it before overwriting.");
      }
    }
    const estimate = await syncZohoEstimate({ crmQuoteKey: seed.crm_quote_key, payload, estimateId: seed.zoho_estimate_id });
    if (seed.zoho_estimate_id && estimate.estimate_id !== seed.zoho_estimate_id) throw new Error("Zoho resolved the CRM Quote Key to a different quotation; reconciliation is required");
    const refreshed = await getZohoEstimate(estimate.estimate_id);
    if (refreshed.status !== "draft" || refreshed.currency_code !== "SGD") throw new Error("Zoho returned a quotation with an unexpected status or currency");
    if (quotePayloadHash(comparableEstimate(refreshed as unknown as Record<string, unknown>)) !== quotePayloadHash(comparableEstimate(payload))) throw new Error("Zoho quotation details do not match the CRM draft");
    if (Math.round(Number(refreshed.total) * 100) !== seed.quoted_total_cents) throw new Error("Zoho total does not match the CRM total");
    const pdf = await storePdf({ ...seed, zoho_estimate_id: estimate.estimate_id });
    const finalized = await db.updateTable("order_quotations").set({
      status: "zoho_draft", zoho_contact_id: link.zoho_contact_id, zoho_estimate_id: estimate.estimate_id,
      zoho_estimate_number: estimate.estimate_number, zoho_status: refreshed.status,
      zoho_last_modified_time: refreshed.last_modified_time ?? null, synced_payload_hash: payloadHash,
      pdf_storage_path: pdf.path, pdf_sha256: pdf.hash, synced_at: new Date(), sync_error: null, sync_claim_token: null, sync_claimed_at: null,
    }).where("id", "=", id).where("status", "=", "syncing").where("sync_claim_token", "=", claimToken).returning("id").executeTakeFirst();
    if (!finalized) throw new Error("Quotation changed while Zoho was syncing. Reconcile before sending.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Zoho sync failed";
    const conflict = message.includes("changed directly") || message.includes("Only a draft") || message.toLowerCase().includes("reconciliation") || message.includes("CRM Quote Key") || message.includes("could not be confirmed");
    await db.updateTable("order_quotations").set({ status: conflict ? "conflict" : "sync_failed", sync_error: message, sync_claim_token: null, sync_claimed_at: null }).where("id", "=", id).where("status", "=", "syncing").where("sync_claim_token", "=", claimToken).execute();
    throw error;
  } finally { revalidatePath(`/orders/${seed.order_id}`); }
}

export async function getQuotationPdfUrl(quotationId: string, download = false) {
  const id = quotationIdSchema.parse(quotationId);
  const row = await db.selectFrom("order_quotations").select(["order_id", "pdf_storage_path", "zoho_estimate_number"]).where("id", "=", id).executeTakeFirst();
  if (!row?.pdf_storage_path) throw new Error("Generate the official quotation preview first");
  await authorizedOrder(row.order_id, false);
  const fileName = `${row.zoho_estimate_number ?? "Quotation"}.pdf`;
  const { data, error } = await adminClient().storage.from(BUCKET).createSignedUrl(row.pdf_storage_path, SIGNED_URL_SECONDS, download ? { download: fileName } : {});
  if (error || !data) throw new Error("Could not open the quotation PDF");
  return { url: data.signedUrl, fileName };
}

export async function acknowledgeZohoConflict(quotationId: string) {
  const id = quotationIdSchema.parse(quotationId);
  const row = await db.selectFrom("order_quotations").selectAll().where("id", "=", id).executeTakeFirst();
  if (!row || !row.zoho_estimate_id || row.status !== "conflict") throw new Error("This quotation does not have a Zoho conflict to reconcile");
  const { order } = await authorizedOrder(row.order_id, true);
  if (order.current_status !== "order_recorded" && order.current_status !== "quotation_sent") throw new Error("This order is no longer at the quotation stage");
  const remote = await getZohoEstimate(row.zoho_estimate_id);
  if (await crmKeyOf(remote) !== row.crm_quote_key) throw new Error("The Zoho CRM Quote Key no longer matches; do not overwrite or import this document");
  if (remote.status === "draft") {
    await db.updateTable("order_quotations").set({ status: "local_draft", zoho_status: remote.status, zoho_last_modified_time: remote.last_modified_time ?? null, sync_error: null }).where("id", "=", id).where("status", "=", "conflict").execute();
    await syncQuotation(id); // Explicitly overwrite, refetch, verify and rebuild PDF.
  } else if (remote.status === "sent") {
    if (remote.customer_id !== row.zoho_contact_id || remote.currency_code !== "SGD" || !Number.isFinite(Number(remote.total)) || Number(remote.total) < 0) throw new Error("The sent Zoho quotation customer, currency, or total is not safe to import");
    const lines = quotationLineSchema.array().min(1).parse((remote.line_items ?? []).map((line) => ({
      zohoItemId: line.item_id || null, name: line.name || "Zoho item", description: line.description ?? "",
      quantity: Number(line.quantity), rateCents: Math.round(Number(line.rate) * 100), discountPercent: Number.parseFloat(String(line.discount ?? 0)) || 0,
    })));
    const pdf = await storePdf(row);
    await db.updateTable("order_quotations").set({
      status: "zoho_draft", zoho_status: "sent", zoho_last_modified_time: remote.last_modified_time ?? null,
      issue_date: remote.date || row.issue_date, expiry_date: remote.expiry_date || row.expiry_date,
      lines: JSON.stringify(lines) as Json, quoted_total_cents: Math.round(Number(remote.total) * 100), notes: remote.notes ?? "", terms: remote.terms ?? "",
      synced_payload_hash: quotePayloadHash(comparableEstimate(remote as unknown as Record<string, unknown>)), pdf_storage_path: pdf.path, pdf_sha256: pdf.hash, synced_at: new Date(), sync_error: null,
    }).where("id", "=", id).where("status", "=", "conflict").execute();
  } else throw new Error(`Zoho quotation is ${remote.status}; create a controlled revision instead of overwriting it`);
  revalidatePath(`/orders/${row.order_id}`);
}

export async function reconcileUncertainQuotation(quotationId: string) {
  const id = quotationIdSchema.parse(quotationId);
  const row = await db.selectFrom("order_quotations").selectAll().where("id", "=", id).executeTakeFirst();
  if (!row || row.status !== "conflict" || row.zoho_estimate_id) throw new Error("This quotation does not have an uncertain Zoho creation to check");
  await authorizedOrder(row.order_id, true);
  const matches = await findZohoEstimatesByCrmQuoteKey(row.crm_quote_key);
  if (matches.length > 1) throw new Error("Multiple Zoho quotations have this CRM Quote Key; an admin must reconcile them in Zoho Books");
  if (matches.length === 0) {
    await db.updateTable("order_quotations").set({ status: "local_draft", sync_error: "Zoho was checked and no matching quotation was found. You may create the Zoho draft again." })
      .where("id", "=", id).where("status", "=", "conflict").where("zoho_estimate_id", "is", null).executeTakeFirstOrThrow();
  } else {
    const estimate = matches[0];
    await db.updateTable("order_quotations").set({
      status: "local_draft", zoho_estimate_id: estimate.estimate_id, zoho_estimate_number: estimate.estimate_number,
      zoho_status: estimate.status, zoho_last_modified_time: estimate.last_modified_time ?? null,
      sync_error: "Recovered the quotation created by the interrupted Zoho response. Updating it by ID now.",
    }).where("id", "=", id).where("status", "=", "conflict").where("zoho_estimate_id", "is", null).executeTakeFirstOrThrow();
    await syncQuotation(id);
  }
  revalidatePath(`/orders/${row.order_id}`);
}

export async function recoverStaleQuotationClaim(quotationId: string) {
  const id = quotationIdSchema.parse(quotationId);
  const row = await db.selectFrom("order_quotations").selectAll().where("id", "=", id).executeTakeFirst();
  if (!row || (row.status !== "syncing" && row.status !== "sending")) throw new Error("This quotation has no active operation to recover");
  await authorizedOrder(row.order_id, true);
  if (!row.sync_claimed_at || new Date(row.sync_claimed_at).getTime() > Date.now() - 5 * 60_000) throw new Error("Zoho is still processing this operation. Try again in a few minutes.");
  if (!row.zoho_estimate_id) {
    await db.updateTable("order_quotations").set({ status: "local_draft", sync_claim_token: null, sync_claimed_at: null, sync_error: "Recovered an interrupted Zoho operation; sync again." }).where("id", "=", id).where("sync_claim_token", "=", row.sync_claim_token).execute();
  } else {
    const remote = await getZohoEstimate(row.zoho_estimate_id);
    const nextStatus = row.status === "sending" && remote.status === "draft" ? "zoho_draft" : "conflict";
    await db.updateTable("order_quotations").set({ status: nextStatus, zoho_status: remote.status, zoho_last_modified_time: remote.last_modified_time ?? null, sync_claim_token: null, sync_claimed_at: null, sync_error: nextStatus === "conflict" ? "Interrupted operation reconciled with Zoho; review the remote state." : null }).where("id", "=", id).where("sync_claim_token", "=", row.sync_claim_token).execute();
  }
  revalidatePath(`/orders/${row.order_id}`);
}

export async function confirmQuotationSent(input: unknown) {
  const parsed = sendQuotationSchema.parse(input);
  const row = await db.selectFrom("order_quotations").selectAll().where("id", "=", parsed.quotationId).executeTakeFirst();
  if (!row) throw new Error("Quotation not found");
  const { session, order } = await authorizedOrder(row.order_id, true);
  if (order.current_status !== "order_recorded" && order.current_status !== "quotation_sent") throw new Error("This order is no longer at the quotation stage");
  if (row.status !== "zoho_draft" || !row.zoho_estimate_id || !row.synced_payload_hash || !row.pdf_storage_path || !row.pdf_sha256) throw new Error("Sync and preview the latest quotation before confirming it sent");
  const remote = await getZohoEstimate(row.zoho_estimate_id);
  if (remote.last_modified_time && remote.last_modified_time !== row.zoho_last_modified_time) {
    await db.updateTable("order_quotations").set({ status: "conflict", sync_error: "Zoho changed after the last preview" }).where("id", "=", row.id).execute();
    throw new Error("Zoho changed after the last preview. Reconcile before sending.");
  }
  const sendClaimToken = randomUUID();
  await db.transaction().execute(async (trx) => {
    const locked = await trx.selectFrom("orders").select(["current_status", "lead_id", "appointment_id"]).where("id", "=", row.order_id).forUpdate().executeTakeFirstOrThrow();
    if (locked.current_status !== "order_recorded" && locked.current_status !== "quotation_sent") throw new Error("This order is no longer at the quotation stage");
    const claimed = await trx.updateTable("order_quotations").set({ status: "sending", sync_error: null, sync_claim_token: sendClaimToken, sync_claimed_at: new Date() })
      .where("id", "=", row.id)
      .where("status", "=", "zoho_draft")
      .where(sql<boolean>`date_trunc('milliseconds', updated_at) = ${row.updated_at}`)
      .returning("id").executeTakeFirst();
    if (!claimed) throw new Error("Quotation changed or is already being sent. Refresh and try again.");
  });
  try {
    if (remote.status === "draft") await markZohoEstimateSent(row.zoho_estimate_id);
    else if (remote.status !== "sent") throw new Error(`Zoho quotation is already ${remote.status}`);
    await db.transaction().execute(async (trx) => {
      const locked = await trx.selectFrom("orders").select(["current_status", "lead_id", "appointment_id"]).where("id", "=", row.order_id).forUpdate().executeTakeFirstOrThrow();
      if (locked.current_status !== "order_recorded" && locked.current_status !== "quotation_sent") throw new Error("This order changed while the quotation was being sent");
    const sentAt = new Date();
      const sentQuote = await trx.updateTable("order_quotations").set({ status: "sent", zoho_status: "sent", sent_at: sentAt, sent_by: session.user.id, sent_channel: parsed.channel, sent_note: parsed.note || null, sync_claim_token: null, sync_claimed_at: null }).where("id", "=", row.id).where("status", "=", "sending").where("sync_claim_token", "=", sendClaimToken).returning("id").executeTakeFirst();
      if (!sentQuote) throw new Error("Quotation changed while it was being sent");
      await trx.updateTable("orders").set({ price_quoted_cents: row.quoted_total_cents, updated_at: sentAt }).where("id", "=", row.order_id).execute();
    if (locked.current_status === "order_recorded") {
      await trx.insertInto("order_status_events").values({ order_id: row.order_id, status: "quotation_sent", note: `Quotation ${row.zoho_estimate_number ?? ""} sent via ${parsed.channel}`.trim(), created_by: session.user.id }).execute();
      const leadId = locked.lead_id ?? (locked.appointment_id ? (await trx.selectFrom("appointments").select("lead_id").where("id", "=", locked.appointment_id).executeTakeFirst())?.lead_id : null);
      if (leadId) {
        const lead = await trx.selectFrom("leads").select("funnel_stage").where("id", "=", leadId).forUpdate().executeTakeFirst();
        const milestone = leadMilestoneForOrderStatus("quotation_sent");
        if (lead && milestone) {
          const validityDays = Math.max(1, Math.round((new Date(String(row.expiry_date)).getTime() - new Date(String(row.issue_date)).getTime()) / 86_400_000));
          const breakdown = linesOf(row).map((line) => `${line.name}: ${line.quantity} × $${(line.rateCents / 100).toFixed(2)}`).join("\n");
          await trx.updateTable("leads").set({ funnel_stage: milestone.stage, last_outcome: milestone.outcome, quotation_sent_at: sentAt, latest_quote_cents: row.quoted_total_cents, quotation_breakdown: breakdown, quote_valid_days: validityDays, updated_at: sentAt }).where("id", "=", leadId).execute();
          if (lead.funnel_stage !== milestone.stage) await trx.insertInto("lead_stage_events").values({ lead_id: leadId, from_stage: lead.funnel_stage, to_stage: milestone.stage, changed_at: sentAt, changed_by: session.user.id, source: "system" }).execute();
        }
      }
    }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not confirm the Zoho quotation";
    await db.updateTable("order_quotations").set({ status: "conflict", sync_error: `Confirm sent needs reconciliation: ${message}`, sync_claim_token: null, sync_claimed_at: null }).where("id", "=", row.id).where("status", "=", "sending").where("sync_claim_token", "=", sendClaimToken).execute();
    throw error;
  }
  revalidatePath(`/orders/${row.order_id}`); revalidatePath("/orders"); revalidatePath("/leads");
}

export async function createQuotationRevision(quotationId: string) {
  const id = quotationIdSchema.parse(quotationId);
  const source = await db.selectFrom("order_quotations").selectAll().where("id", "=", id).executeTakeFirst();
  if (!source) throw new Error("Quotation not found");
  const { session } = await authorizedOrder(source.order_id, true);
  const order = await db.selectFrom("orders").select("current_status").where("id", "=", source.order_id).executeTakeFirstOrThrow();
  if (order.current_status !== "order_recorded" && order.current_status !== "quotation_sent") throw new Error("Revisions can only be created during the quotation stage");
  if (source.status !== "sent") throw new Error("Only a sent quotation needs a revision");
  const nextId = randomUUID();
  await db.transaction().execute(async (trx) => {
    const lockedOrder = await trx.selectFrom("orders").select("current_status").where("id", "=", source.order_id).forUpdate().executeTakeFirstOrThrow();
    if (lockedOrder.current_status !== "order_recorded" && lockedOrder.current_status !== "quotation_sent") throw new Error("Revisions can only be created during the quotation stage");
    const locked = await trx.selectFrom("order_quotations").selectAll().where("id", "=", id).forUpdate().executeTakeFirstOrThrow();
    if (locked.superseded_at || locked.status !== "sent") throw new Error("A revision already exists. Refresh and try again.");
    if (["pending", "uncertain"].includes(locked.invoice_sync_state) || locked.zoho_invoice_id) throw new Error("A revision cannot be created while an invoice is pending, uncertain, or already exists");
    const now = new Date();
    const issueDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Singapore", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
    const expiry = new Date(`${issueDate}T00:00:00Z`); expiry.setUTCDate(expiry.getUTCDate() + 7);
    await trx.updateTable("order_quotations").set({ status: "superseded", superseded_at: now, superseded_by: session.user.id }).where("id", "=", id).execute();
    await trx.insertInto("order_quotations").values({ id: nextId, order_id: locked.order_id, revision: locked.revision + 1, crm_quote_key: `dw:${locked.order_id}:v${locked.revision + 1}:${nextId}`, issue_date: issueDate, expiry_date: expiry.toISOString().slice(0, 10), lines: locked.lines, quoted_total_cents: locked.quoted_total_cents, customer_message: locked.customer_message, notes: locked.notes, terms: locked.terms, status: "local_draft", created_by: session.user.id, updated_by: session.user.id }).execute();
  });
  revalidatePath(`/orders/${source.order_id}`);
  return { id: nextId };
}

/** Idempotent remote prerequisite for quotation_sent -> deposit_received. */
async function findConvertedInvoiceId(estimateId: string): Promise<string | null> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 750 * attempt));
    const estimate = await getZohoEstimate(estimateId);
    if (estimate.invoice_ids?.[0]) return estimate.invoice_ids[0];
  }
  return null;
}

export async function ensureZohoInvoiceForOrder(orderId: string): Promise<void> {
  await requireRole(["ops", "admin"]);
  const invoiceClaimToken = randomUUID();
  const operation = await db.transaction().execute(async (trx) => {
    const order = await trx.selectFrom("orders").select(["current_status", "display_id", "order_reference", "consultant_id"]).where("id", "=", orderId).forUpdate().executeTakeFirst();
    if (!order || order.current_status !== "quotation_sent") throw new Error("The order must be at Quotation Sent before creating its Zoho invoice");
    const profile = order.consultant_id ? await trx.selectFrom("profiles").select("full_name").where("id", "=", order.consultant_id).executeTakeFirst() : null;
    const quote = await trx.selectFrom("order_quotations").selectAll().where("order_id", "=", orderId).where("superseded_at", "is", null).forUpdate().executeTakeFirst();
    if (!quote) throw new Error("Create and send the official Zoho quotation before recording the deposit");
    if (quote.status !== "sent" || !quote.zoho_estimate_id) throw new Error("The official Zoho quotation must be sent before recording the deposit");
    if (quote.zoho_invoice_id && quote.invoice_sync_state === "created") return { order: { ...order, consultant_name: profile?.full_name ?? null }, quote, claimed: false, reconcileOnly: false };
    const staleBefore = new Date(Date.now() - 2 * 60_000);
    const reconcileOnly = quote.invoice_sync_state === "uncertain" || quote.invoice_sync_state === "pending";
    const claim = await trx.updateTable("order_quotations").set({
      invoice_sync_state: "pending", invoice_claimed_at: new Date(), invoice_claim_token: invoiceClaimToken,
      invoice_sync_error: null, invoice_uncertain_at: reconcileOnly ? (quote.invoice_uncertain_at ?? quote.invoice_claimed_at ?? new Date()) : null,
    })
      .where("id", "=", quote.id).where("superseded_at", "is", null).where("status", "=", "sent")
      .where((eb) => eb.or([eb("invoice_sync_state", "in", ["not_started", "failed", "uncertain"]), eb("invoice_claimed_at", "<", staleBefore)]))
      .returning("id").executeTakeFirst();
    if (!claim) throw new Error("The Zoho invoice is already being created. Wait a moment and try again.");
    return { order: { ...order, consultant_name: profile?.full_name ?? null }, quote, claimed: true, reconcileOnly };
  });
  const { order, quote, claimed, reconcileOnly } = operation;
  let conversionUncertain = false;
  try {
    const estimateId = quote.zoho_estimate_id;
    if (!estimateId) throw new Error("The official Zoho quotation is missing its Estimate ID");
    const remote = await getZohoEstimate(estimateId);
    const binding = await getZohoBooksBinding();
    if (!quote.zoho_contact_id) throw new Error("The sent quotation has no confirmed Zoho customer");
    const desired = toZohoEstimatePayload({
      contactId: quote.zoho_contact_id, referenceNumber: order.order_reference || order.display_id,
      issueDate: quotationDateOnly(quote.issue_date), expiryDate: quotationDateOnly(quote.expiry_date), lines: linesOf(quote),
      notes: quote.notes ?? "", terms: quote.terms ?? "", salespersonName: order.consultant_name,
      templateId: binding.estimateTemplateId,
    });
    if (await crmKeyOf(remote) !== quote.crm_quote_key || !["sent", "accepted", "invoiced"].includes(remote.status) || remote.currency_code !== "SGD" || Math.round(Number(remote.total) * 100) !== quote.quoted_total_cents || quotePayloadHash(comparableEstimate(remote as unknown as Record<string, unknown>)) !== quotePayloadHash(comparableEstimate(desired))) {
      throw new Error("The sent Zoho quotation no longer matches the CRM snapshot; reconcile it before creating an invoice");
    }
    const existingInvoiceId = quote.zoho_invoice_id ?? remote.invoice_ids?.[0];
    if (quote.zoho_invoice_id && Array.isArray(remote.invoice_ids) && !remote.invoice_ids.includes(quote.zoho_invoice_id)) throw new Error("The stored Zoho invoice is no longer linked to this quotation");
    let created: { invoice_id: string; invoice_number?: string };
    if (existingInvoiceId) {
      created = { invoice_id: existingInvoiceId };
    } else if (reconcileOnly) {
      const reconciledId = await findConvertedInvoiceId(estimateId);
      if (!reconciledId) {
        const uncertainSince = quote.invoice_uncertain_at ?? quote.invoice_claimed_at ?? new Date();
        if (new Date(uncertainSince).getTime() > Date.now() - 5 * 60_000) conversionUncertain = true;
        throw new Error(conversionUncertain
          ? "Zoho invoice creation is still uncertain. Wait five minutes, then check again; no second invoice will be created meanwhile."
          : "Zoho was checked after the safety wait and no linked invoice was found. Run the deposit action again to create it.");
      }
      created = { invoice_id: reconciledId };
    } else {
      conversionUncertain = true;
      try {
        created = await convertZohoEstimateToInvoice(estimateId);
      } catch (error) {
        const reconciledId = await findConvertedInvoiceId(estimateId);
        if (!reconciledId) {
          conversionUncertain = true;
          const reason = error instanceof Error ? error.message : "Zoho did not confirm the conversion";
          throw new Error(`Zoho may have created the invoice but its response was lost (${reason}). Wait five minutes, then check again; creation is locked meanwhile.`);
        }
        created = { invoice_id: reconciledId };
      }
    }
    if (claimed && !quote.zoho_invoice_id) {
      await db.updateTable("order_quotations").set({ zoho_invoice_id: created.invoice_id, zoho_invoice_number: created.invoice_number ?? null })
        .where("id", "=", quote.id).where("invoice_sync_state", "=", "pending").where("invoice_claim_token", "=", invoiceClaimToken).executeTakeFirstOrThrow();
      conversionUncertain = false;
    }
    const invoice = await getZohoInvoice(created.invoice_id);
    // Zoho's live Invoice response does not consistently include an
    // `invoiced_estimate_id`, even for invoices created from an Estimate. The
    // Estimate's `invoice_ids` relationship is the authoritative link and is
    // also what the retry/reconciliation path uses to prevent duplicates.
    const linkedInvoiceId = await findConvertedInvoiceId(estimateId);
    const usableInvoiceStatuses = new Set(["draft", "sent", "overdue", "paid", "partially_paid"]);
    if (!invoice.status || !usableInvoiceStatuses.has(invoice.status) || linkedInvoiceId !== invoice.invoice_id || invoice.customer_id !== quote.zoho_contact_id || invoice.currency_code !== "SGD" || Math.round(Number(invoice.total) * 100) !== quote.quoted_total_cents) throw new Error("The Zoho invoice is void, unusable, or does not match the sent quotation; reconcile it before recording the deposit");
    if (!claimed) return;
    const finalized = await db.updateTable("order_quotations").set({ zoho_invoice_id: invoice.invoice_id, zoho_invoice_number: invoice.invoice_number ?? null, invoice_created_at: new Date(), invoice_sync_state: "created", invoice_claim_token: null, invoice_claimed_at: null, invoice_uncertain_at: null, invoice_sync_error: null, zoho_status: "invoiced" }).where("id", "=", quote.id).where("invoice_claim_token", "=", invoiceClaimToken).returning("id").executeTakeFirst();
    if (!finalized) throw new Error("The invoice was created in Zoho but its CRM claim changed; reconcile before recording the deposit");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Zoho invoice creation failed";
    if (claimed) await db.updateTable("order_quotations").set({
      invoice_sync_state: conversionUncertain ? "uncertain" : "failed", invoice_claim_token: null, invoice_claimed_at: null,
      invoice_uncertain_at: conversionUncertain ? (quote.invoice_uncertain_at ?? new Date()) : null, invoice_sync_error: message,
    }).where("id", "=", quote.id).where("invoice_sync_state", "=", "pending").where("invoice_claim_token", "=", invoiceClaimToken).execute();
    throw error;
  }
}
