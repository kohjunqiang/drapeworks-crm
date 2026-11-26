"use server";

import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";

import { requireRole, requireSession } from "@/lib/auth/require-role";
import { db } from "@/lib/db/kysely";
import type { DB, Json, OrderQuotations } from "@/lib/db/schema";
import { sql, type Selectable, type Transaction } from "kysely";
import { leadMilestoneForOrderStatus } from "@/lib/status-flow";
import { resolveLeadForOrderSync } from "@/lib/actions/order-customer";
import { adminClient } from "@/lib/supabase/admin";
import {
  confirmZohoCustomerSchema,
  quotationIdSchema,
  saveQuotationSchema,
  sendQuotationSchema,
  importZohoQuotationSchema,
  quotationLineSchema,
  reviewedZohoQuotationSchema,
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
  findZohoEstimateByNumber,
  listZohoContacts,
  listZohoItems,
  markZohoEstimateSent,
  syncZohoEstimate,
} from "@/lib/zoho/books";
import { estimateSnapshotHash, zohoAdoptionFingerprint } from "@/lib/quotations/hash";
import { hasZohoInvoice, invoiceFinancialDifferences, invoiceFingerprint, invoiceReconciliationIssues, optionalMoneyCents, orderReconciliationFingerprint } from "@/lib/quotations/invoice-reconciliation";
import type { ZohoEstimate, ZohoInvoice } from "@/lib/zoho/books";
import { assertEstimateEditable, assertQuotationStage, crmKeyConflicts, hasZohoDrift, QUOTATION_INVOICED_MESSAGE, quotationBreakdown } from "@/lib/quotations/lifecycle";
import { adoptedTotalMatches, isValidZohoDate, zohoAdoptionIssues, zohoLineForDisplay, zohoRemoteTotalCents, zohoValidatedLines } from "@/lib/quotations/zoho-adoption";
import { defaultCustomerMessage, isGeneratedCustomerMessage, quotationDateOnly, quotationTotalCents, toZohoEstimatePayload } from "@/lib/quotations/model";
import { actionErrorMessage, toActionResult, UserFacingError } from "@/lib/user-facing-error";

const BUCKET = "customer-quotations";
const SIGNED_URL_SECONDS = 300;

async function authorizedOrder(orderId: string, write: boolean) {
  const session = await requireSession();
  const order = await db.selectFrom("orders")
    .innerJoin("customers", "customers.id", "orders.customer_id")
    .leftJoin("profiles", "profiles.id", "orders.consultant_id")
    .select([
      "orders.id", "orders.display_id", "orders.order_reference", "orders.current_status", "orders.consultant_id", "orders.site_address", "orders.price_quoted_cents", "orders.deposit_cents",
      "customers.id as customer_id", "customers.name as customer_name", "customers.email as customer_email", "customers.mobile as customer_mobile",
      "profiles.full_name as consultant_name",
    ])
    .where("orders.id", "=", orderId).executeTakeFirst();
  if (!order) throw new UserFacingError("Order not found");
  const isOwner = session.profile.role === "consultant" && order.consultant_id === session.user.id;
  const canWrite = session.profile.role === "admin" || isOwner;
  const canRead = canWrite || session.profile.role === "ops";
  if ((write && !canWrite) || (!write && !canRead)) throw new UserFacingError("Forbidden");
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
  if (query.trim().length < 2) throw new UserFacingError("Enter at least two characters");
  const contacts = await listZohoContacts(query.trim());
  return contacts.map((contact) => ({ id: contact.contact_id, name: contact.contact_name, company: contact.company_name ?? "", email: contact.email ?? "", phone: contact.mobile || contact.phone || "" }));
}

export async function confirmZohoCustomer(input: unknown) {
  const parsed = confirmZohoCustomerSchema.parse(input);
  const { session, order } = await authorizedOrder(parsed.orderId, true);
  const existingEstimate = await db.selectFrom("order_quotations").select("zoho_estimate_id").where("order_id", "=", parsed.orderId).where("superseded_at", "is", null).executeTakeFirst();
  if (existingEstimate?.zoho_estimate_id) throw new UserFacingError("The Zoho customer cannot be changed after an official draft exists");
  const contact = await getZohoContact(parsed.zohoContactId);
  if (contact.status && contact.status !== "active") throw new UserFacingError("That Zoho customer is not active");
  if (contact.contact_type !== "customer") throw new UserFacingError("Only a Zoho customer can be linked to an order");
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
  if (existingEstimate?.zoho_estimate_id) throw new UserFacingError("The Zoho customer cannot be changed after an official draft exists");
  let contact;
  try {
    contact = await createZohoContact({ name: order.customer_name, email: order.customer_email, mobile: order.customer_mobile, address: order.site_address });
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
  assertQuotationStage(order.current_status);
  const total = quotationTotalCents(parsed.lines);
  const result = await db.transaction().execute(async (trx) => {
    const current = await trx.selectFrom("order_quotations").selectAll()
      .where("order_id", "=", parsed.orderId).where("superseded_at", "is", null).forUpdate().executeTakeFirst();
    if (current?.zoho_invoice_id) throw new UserFacingError(QUOTATION_INVOICED_MESSAGE);
    if (current && (["pending", "uncertain"].includes(current.invoice_sync_state) || ["pending", "uncertain"].includes(current.payment_sync_state))) throw new UserFacingError("An invoice or payment operation is in progress. Resolve it before editing the quotation.");
    if (current?.status === "syncing" || current?.status === "sending") throw new UserFacingError("This quotation is already being processed. Wait and refresh.");
    if (parsed.quotationId && current?.id !== parsed.quotationId) throw new UserFacingError("The current quotation changed. Refresh and try again.");
    if (current && parsed.expectedUpdatedAt && new Date(current.updated_at).toISOString() !== parsed.expectedUpdatedAt) {
      throw new UserFacingError("This quotation was edited elsewhere. Refresh before saving.");
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

async function crmKeyOf(estimate: { custom_fields?: Array<{ customfield_id?: string; api_name?: string; value?: unknown; label?: string }> }): Promise<unknown> {
  const binding = await getZohoBooksBinding();
  return estimate.custom_fields?.find((field) => field.customfield_id === binding.crmKeyFieldId || field.api_name === binding.crmKeyApiName || field.label === "CRM Quote Key")?.value;
}

async function storePdf(row: Pick<OrderQuotations, "id" | "order_id" | "zoho_estimate_id">) {
  if (!row.zoho_estimate_id) throw new UserFacingError("The quotation has not been created in Zoho");
  const bytes = await getZohoEstimatePdf(row.zoho_estimate_id);
  const hash = createHash("sha256").update(bytes).digest("hex");
  const path = `quotes/${row.order_id}/${row.id}/${hash}.pdf`;
  const { error } = await adminClient().storage.from(BUCKET).upload(path, bytes, { contentType: "application/pdf", upsert: false });
  if (error && !error.message.toLowerCase().includes("already exists")) throw new UserFacingError("Could not store the official quotation PDF");
  return { path, hash };
}

// Privileged binding for the reviewed overwrite only: proves the caller saw
// this exact CRM revision and remote fingerprint, so it may claim statuses a
// plain sync refuses (conflict and sent included) and skip the ordinary drift
// gate — the reviewer already approved that exact remote state. Never part of
// the public action's argument surface.
type ReviewedSync = {
  expectedUpdatedAt: string;
  remoteFingerprint: string;
  auditNote: string;
};

export async function syncQuotation(quotationId: string) {
  return syncQuotationInternal(quotationIdSchema.parse(quotationId));
}

async function syncQuotationInternal(id: string, reviewed?: ReviewedSync) {
  const seed = await db.selectFrom("order_quotations").selectAll().where("id", "=", id).executeTakeFirst();
  if (!seed) throw new UserFacingError("Quotation not found");
  if (seed.zoho_invoice_id) throw new UserFacingError(QUOTATION_INVOICED_MESSAGE);
  const { session, order } = await authorizedOrder(seed.order_id, true);
  assertQuotationStage(order.current_status);
  if (seed.status === "superseded" || (!reviewed && seed.status === "sent")) throw new UserFacingError("There are no unsynced changes on this quotation");
  if (reviewed && new Date(seed.updated_at).toISOString() !== reviewed.expectedUpdatedAt) {
    throw new UserFacingError("This quotation changed since it was previewed. Review it again.");
  }
  const previouslySent = seed.sent_at !== null;
  const link = await db.selectFrom("customer_zoho_links").select("zoho_contact_id").where("customer_id", "=", order.customer_id).executeTakeFirst();
  if (!link) throw new UserFacingError("Confirm the matching Zoho customer first");
  const binding = await getZohoBooksBinding();

  const payload = toZohoEstimatePayload({
    contactId: link.zoho_contact_id, referenceNumber: order.order_reference || order.display_id,
    issueDate: quotationDateOnly(seed.issue_date), expiryDate: quotationDateOnly(seed.expiry_date), lines: linesOf(seed),
    notes: seed.notes ?? "", terms: seed.terms ?? "", salespersonName: order.consultant_name,
    templateId: binding.estimateTemplateId,
  });
  const payloadHash = estimateSnapshotHash(payload);
  const claimToken = randomUUID();
  const claimed = await db.updateTable("order_quotations").set({ status: "syncing", sync_error: null, sync_claim_token: claimToken, sync_claimed_at: new Date() })
    .where("id", "=", id)
    // PostgreSQL keeps microseconds while the pg driver exposes Date values at
    // millisecond precision. Compare at the precision the client can preserve,
    // otherwise an unchanged quotation can never acquire its sync claim.
    .where(sql<boolean>`date_trunc('milliseconds', updated_at) = ${seed.updated_at}`)
    .where("status", "in", reviewed ? [...REVIEWABLE_STATUSES] : ["local_draft", "zoho_draft", "sync_failed"])
    .returningAll().executeTakeFirst();
  if (!claimed) throw new UserFacingError("Quotation changed or is already syncing. Refresh and try again.");

  try {
    if (seed.zoho_estimate_id) {
      const remote = await getZohoEstimate(seed.zoho_estimate_id);
      if (crmKeyConflicts(await crmKeyOf(remote), seed.crm_quote_key)) throw new UserFacingError("The Zoho CRM Quote Key changed; reconciliation is required to avoid a duplicate");
      assertEstimateEditable(remote);
      if (reviewed) {
        // The reviewer approved exactly this remote state: it must not have
        // moved since the preview, and when it matches the ordinary drift
        // gate is intentionally skipped — the remote IS the drift.
        if (zohoAdoptionFingerprint(remote as unknown as Record<string, unknown>) !== reviewed.remoteFingerprint) {
          throw new UserFacingError("The Zoho quotation changed since it was previewed. Review it again before overwriting.");
        }
      } else if (hasZohoDrift({
        storedModified: seed.zoho_last_modified_time,
        remoteModified: remote.last_modified_time,
        remoteHash: estimateSnapshotHash(remote as unknown as Record<string, unknown>),
        storedHash: seed.synced_payload_hash,
        payloadHash,
      })) {
        await db.updateTable("order_quotations").set({ status: "conflict", sync_error: "This quotation was changed directly in Zoho Books. Reconcile it before overwriting.", sync_claim_token: null, sync_claimed_at: null }).where("id", "=", id).where("sync_claim_token", "=", claimToken).execute();
        throw new UserFacingError("This quotation was changed directly in Zoho Books. Reconcile it before overwriting.");
      }
    }
    const estimate = await syncZohoEstimate({ crmQuoteKey: seed.crm_quote_key, payload, estimateId: seed.zoho_estimate_id });
    if (seed.zoho_estimate_id && estimate.estimate_id !== seed.zoho_estimate_id) throw new UserFacingError("Zoho resolved the CRM Quote Key to a different quotation; reconciliation is required");
    let refreshed = await getZohoEstimate(estimate.estimate_id);
    if (previouslySent && refreshed.status === "draft") {
      // Zoho may revert an edited estimate to draft; the customer already has it.
      await markZohoEstimateSent(estimate.estimate_id);
      refreshed = await getZohoEstimate(estimate.estimate_id);
    }
    // A never-sent quotation may already be sent in Zoho (e.g. a confirm-sent
    // whose CRM write failed); only an invoiced estimate is unusable. The row
    // stays zoho_draft so Confirm quotation sent can finish the send — it skips
    // markZohoEstimateSent when Zoho already reports sent.
    const expectedStatus = previouslySent ? refreshed.status !== "draft" && refreshed.status !== "invoiced" : refreshed.status !== "invoiced";
    if (!expectedStatus || refreshed.currency_code !== "SGD") throw new Error("Zoho returned a quotation with an unexpected status or currency");
    if (estimateSnapshotHash(refreshed as unknown as Record<string, unknown>) !== estimateSnapshotHash(payload)) throw new Error("Zoho quotation details do not match the CRM draft");
    if (Math.round(Number(refreshed.total) * 100) !== seed.quoted_total_cents) throw new Error("Zoho total does not match the CRM total");
    const pdf = await storePdf({ ...seed, zoho_estimate_id: estimate.estimate_id });
    if (reviewed) {
      // Same mixed-version guard as adoption: if Zoho moved while its PDF was
      // downloading, the stored PDF must not describe a different version
      // than the details we are about to finalize.
      const afterPdf = await getZohoEstimate(estimate.estimate_id);
      if (zohoAdoptionFingerprint(afterPdf as unknown as Record<string, unknown>) !== zohoAdoptionFingerprint(refreshed as unknown as Record<string, unknown>)) {
        throw new UserFacingError("The Zoho quotation changed while its PDF was being fetched. Review it again.");
      }
    }
    const finalized = await db.transaction().execute(async (trx) => {
      const locked = await trx.selectFrom("orders").select("current_status").where("id", "=", seed.order_id).forUpdate().executeTakeFirstOrThrow();
      assertQuotationStage(locked.current_status);
      const done = await trx.updateTable("order_quotations").set({
        status: previouslySent ? "sent" : "zoho_draft", zoho_contact_id: link.zoho_contact_id, zoho_estimate_id: estimate.estimate_id,
        zoho_estimate_number: estimate.estimate_number, zoho_status: refreshed.status,
        zoho_last_modified_time: refreshed.last_modified_time ?? null, synced_payload_hash: payloadHash,
        pdf_storage_path: pdf.path, pdf_sha256: pdf.hash, synced_at: new Date(), sync_error: null, sync_claim_token: null, sync_claimed_at: null,
      }).where("id", "=", id).where("status", "=", "syncing").where("sync_claim_token", "=", claimToken).returning("id").executeTakeFirst();
      if (!done) return done;
      if (reviewed?.auditNote) {
        await trx.insertInto("order_status_events").values({
          order_id: seed.order_id, status: locked.current_status,
          note: `Quotation ${estimate.estimate_number ?? ""}: ${reviewed.auditNote}`.trim(), created_by: session.user.id,
        }).execute();
      }
      if (!previouslySent) return done;
      const latest = await trx.selectFrom("order_quotation_versions").select((eb) => eb.fn.max("version").as("max_version")).where("quotation_id", "=", id).executeTakeFirst();
      await trx.insertInto("order_quotation_versions").values({
        quotation_id: id, version: Number(latest?.max_version ?? 0) + 1, lines: JSON.stringify(linesOf(seed)) as Json,
        quoted_total_cents: seed.quoted_total_cents, pdf_storage_path: pdf.path, created_by: session.user.id,
      }).execute();
      await applyQuotedPrice(trx, { orderId: seed.order_id, totalCents: seed.quoted_total_cents, lines: linesOf(seed) });
      return done;
    });
    if (!finalized) throw new UserFacingError("Quotation changed while Zoho was syncing. Reconcile before sending.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Zoho sync failed";
    const conflict = message.includes("changed directly") || message.toLowerCase().includes("reconciliation") || message.includes("CRM Quote Key") || message.includes("could not be confirmed");
    await db.updateTable("order_quotations").set({ status: conflict ? "conflict" : "sync_failed", sync_error: message, sync_claim_token: null, sync_claimed_at: null }).where("id", "=", id).where("status", "=", "syncing").where("sync_claim_token", "=", claimToken).execute();
    throw error;
  } finally {
    revalidatePath(`/orders/${seed.order_id}`);
    // A previously-sent quotation re-syncs its total onto the order and lead;
    // both lists must refresh too.
    if (previouslySent) { revalidatePath("/orders"); revalidatePath("/leads"); }
  }
}

export async function getQuotationPdfUrl(quotationId: string, download = false) {
  const id = quotationIdSchema.parse(quotationId);
  const row = await db.selectFrom("order_quotations").select(["order_id", "pdf_storage_path", "zoho_estimate_number"]).where("id", "=", id).executeTakeFirst();
  if (!row?.pdf_storage_path) throw new UserFacingError("Generate the official quotation preview first");
  await authorizedOrder(row.order_id, false);
  const fileName = `${row.zoho_estimate_number ?? "Quotation"}.pdf`;
  const { data, error } = await adminClient().storage.from(BUCKET).createSignedUrl(row.pdf_storage_path, SIGNED_URL_SECONDS, download ? { download: fileName } : {});
  if (error || !data) throw new UserFacingError("Could not open the quotation PDF");
  return { url: data.signedUrl, fileName };
}

// Reconciliation is a two-sided choice now — the reviewer picks "Use Zoho
// details" or "Overwrite Zoho with CRM" inside the comparison dialog, and both
// apply paths verify the previewed state before touching anything. The old
// one-way action would let a caller overwrite Zoho sight unseen, so it refuses.
export async function acknowledgeZohoConflict(quotationId: string) {
  await requireSession();
  const id = quotationIdSchema.parse(quotationId);
  const row = await db.selectFrom("order_quotations").select(["id", "order_id"]).where("id", "=", id).executeTakeFirst();
  if (!row) throw new UserFacingError("Quotation not found");
  await authorizedOrder(row.order_id, true);
  throw new UserFacingError("Use Review Zoho details to compare both sides, then choose whether to keep the Zoho details or overwrite Zoho from the CRM.");
}

// Shared guards for the review-and-apply flow: linked, at the quotation stage,
// not final/invoiced, and no invoice, deposit, or sync operation in flight.
const REVIEWABLE_STATUSES = ["local_draft", "zoho_draft", "sync_failed", "conflict", "sent"] as const;

async function reviewedLinkedQuotation(id: string, inspect = false) {
  await requireSession();
  const row = await db.selectFrom("order_quotations").selectAll().where("id", "=", id).executeTakeFirst();
  if (!row) throw new UserFacingError("Quotation not found");
  const { session, order } = await authorizedOrder(row.order_id, true);
  if (!inspect) assertQuotationStage(order.current_status);
  if (row.superseded_at) throw new UserFacingError("This quotation has been superseded");
  if (!inspect && row.zoho_invoice_id) throw new UserFacingError(QUOTATION_INVOICED_MESSAGE);
  if (!inspect && (row.status === "syncing" || row.status === "sending")) throw new UserFacingError("This quotation is already being processed. Wait and refresh.");
  if (!inspect && (["pending", "uncertain"].includes(row.invoice_sync_state) || ["pending", "uncertain"].includes(row.payment_sync_state))) {
    throw new UserFacingError("A Zoho invoice or deposit operation is still in progress. Resolve it before reviewing this quotation.");
  }
  if (!row.zoho_estimate_id) throw new UserFacingError("This quotation is not linked to a Zoho quotation yet");
  const link = await db.selectFrom("customer_zoho_links").select("zoho_contact_id").where("customer_id", "=", order.customer_id).executeTakeFirst();
  if (!link) throw new UserFacingError("Confirm the matching Zoho customer first");
  return { session, order, row, link };
}

async function checkedLinkedRemote(row: Selectable<OrderQuotations>, contactId: string, inspect = false) {
  const remote = await getZohoEstimate(row.zoho_estimate_id!);
  if (remote.estimate_id !== row.zoho_estimate_id) throw new UserFacingError("Zoho returned a different quotation; review it again");
  // An absent customer_id is unverified identity, not a match.
  if (remote.customer_id !== contactId) throw new UserFacingError("The Zoho quotation belongs to a different customer");
  if (remote.currency_code !== "SGD") throw new UserFacingError("Only SGD quotations can be compared");
  if (crmKeyConflicts(await crmKeyOf(remote), row.crm_quote_key)) throw new UserFacingError("The Zoho quotation is linked to a different CRM quotation");
  if (!inspect) assertEstimateEditable(remote);
  return remote;
}

function quotationOperationIssues(row: Selectable<OrderQuotations>): string[] {
  return row.status === "syncing" || row.status === "sending"
    || ["pending", "uncertain"].includes(row.invoice_sync_state)
    || ["pending", "uncertain"].includes(row.payment_sync_state)
    ? ["A quotation, invoice or payment operation is still in progress. Resolve it, then refresh."] : [];
}

async function inspectExistingInvoice(remote: ZohoEstimate, localInvoiceId: string | null): Promise<{ invoice: ZohoInvoice | null; issues: string[] }> {
  if (remote.invoice_ids?.length !== 1) return { invoice: null, issues: [remote.invoice_ids?.length ? "More than one invoice is linked in Zoho. Review the invoice links in Zoho, then refresh." : "Zoho has not supplied one linked invoice to verify. Check the quotation in Zoho, then refresh."] };
  try {
    const invoice = await getZohoInvoice(remote.invoice_ids[0]);
    const issues = invoiceReconciliationIssues(remote, invoice, localInvoiceId);
    return { invoice: invoice.customer_id === remote.customer_id && invoice.invoice_id === remote.invoice_ids[0] ? invoice : null, issues };
  } catch {
    return { invoice: null, issues: ["The existing invoice could not be verified. Check the Zoho connection and refresh; no records were changed."] };
  }
}

// Fetches the saved CRM quotation and the live Zoho document side by side so
// the dialog can show both, the differences, and any Zoho structures the CRM
// cannot adopt. The returned fingerprints bind the follow-up apply call.
export async function previewQuotationZohoDiff(quotationId: string) {
  const id = quotationIdSchema.parse(quotationId);
  const { order, row, link } = await reviewedLinkedQuotation(id, true);
  const remote = await checkedLinkedRemote(row, link.zoho_contact_id, true);
  const invoiced = hasZohoInvoice(remote) || Boolean(row.zoho_invoice_id);
  const invoiceCheck = invoiced ? await inspectExistingInvoice(remote, row.zoho_invoice_id) : null;
  const operationIssues = quotationOperationIssues(row);
  const frozen = !["order_recorded", "quotation_sent"].includes(order.current_status);
  const adoptionIssues = invoiced ? [...(invoiceCheck?.issues ?? [])] : zohoAdoptionIssues(remote);
  if (invoiced) adoptionIssues.push("Quotation syncing is closed because an invoice exists. Use the order deposit action to verify the invoice and payment.");
  if (frozen) adoptionIssues.push("This order is past the quotation stage.");
  adoptionIssues.push(...operationIssues);
  // Invoiced imports never repair money, so quote/invoice/order differences
  // are non-blocking warnings — each one must be acknowledged before apply.
  const financialDifferences = invoiced && invoiceCheck?.invoice
    ? invoiceFinancialDifferences(remote, invoiceCheck.invoice, order.price_quoted_cents)
    : [];
  const binding = await getZohoBooksBinding();
  const crmPayload = toZohoEstimatePayload({
    contactId: link.zoho_contact_id, referenceNumber: order.order_reference || order.display_id,
    issueDate: quotationDateOnly(row.issue_date), expiryDate: quotationDateOnly(row.expiry_date), lines: linesOf(row),
    notes: row.notes ?? "", terms: row.terms ?? "", salespersonName: order.consultant_name, templateId: binding.estimateTemplateId,
  });
  const zohoLines = (remote.line_items ?? []).map(zohoLineForDisplay);
  const crmLines = linesOf(row);
  // "currently match" compares the actual displayed fields — names and
  // descriptions included — because the snapshot hash ignores a renamed
  // catalog item (item_id wins), which would falsely claim a match.
  const lineKey = (parts: unknown[]) => parts.map((part) => String(part ?? "")).join("");
  const linesIdentical = crmLines.length === zohoLines.length && crmLines.every((line, index) =>
    lineKey([line.name, line.description, line.quantity, line.rateCents, `${line.discountPercent}%`])
    === lineKey([zohoLines[index].name, zohoLines[index].description, zohoLines[index].quantity, zohoLines[index].rateCents, zohoLines[index].discountText]));
  const identical = linesIdentical
    && row.quoted_total_cents === zohoRemoteTotalCents(remote)
    && quotationDateOnly(row.issue_date) === remote.date
    && quotationDateOnly(row.expiry_date) === (remote.expiry_date || null)
    && (row.notes ?? "") === (remote.notes ?? "")
    && (row.terms ?? "") === (remote.terms ?? "")
    && (crmPayload.reference_number ?? "") === (remote.reference_number ?? "")
    && (crmPayload.template_id ?? "") === (remote.template_id ?? "");
  const warnings: string[] = [];
  if (row.sent_at && ["draft", "declined", "expired"].includes(remote.status.toLowerCase())) {
    warnings.push(`The CRM records this quotation as sent, but Zoho currently shows it as "${remote.status}". Use Zoho details keeps your original sent record and changes nothing in Zoho — a deposit can only be converted from a sent or accepted Zoho quotation. Resolve the status in Zoho Books and review again.`);
  }
  return {
    quotationId: row.id,
    crmRevision: new Date(row.updated_at).toISOString(),
    remoteFingerprint: zohoAdoptionFingerprint(remote as unknown as Record<string, unknown>),
    identical,
    warnings,
    adoptIssues: adoptionIssues,
    invoiced,
    overwriteBlockedReason: invoiced ? "This quotation already has an invoice." : frozen ? "This order is past the quotation stage." : operationIssues[0] ?? null,
    invoice: invoiceCheck?.invoice ? {
      number: invoiceCheck.invoice.invoice_number ?? invoiceCheck.invoice.invoice_id,
      status: invoiceCheck.invoice.status ?? "Unknown",
      totalCents: optionalMoneyCents(invoiceCheck.invoice.total),
      paidCents: optionalMoneyCents(invoiceCheck.invoice.payment_made),
      balanceCents: optionalMoneyCents(invoiceCheck.invoice.balance),
      creditsCents: optionalMoneyCents(invoiceCheck.invoice.credits_applied),
    } : null,
    invoiceFingerprint: invoiceCheck?.invoice ? invoiceFingerprint(invoiceCheck.invoice) : null,
    orderFingerprint: orderReconciliationFingerprint(order),
    financialDifferences,
    requiresFinancialAcknowledgement: financialDifferences.length > 0,
    currentOrderTotalCents: order.price_quoted_cents,
    crm: {
      issueDate: quotationDateOnly(row.issue_date), expiryDate: quotationDateOnly(row.expiry_date),
      notes: row.notes ?? "", terms: row.terms ?? "", totalCents: row.quoted_total_cents,
      lines: crmLines, previouslySent: row.sent_at !== null, status: row.status,
    },
    zoho: {
      estimateNumber: remote.estimate_number, status: remote.status, lastModifiedTime: remote.last_modified_time ?? null,
      issueDate: remote.date ?? null, expiryDate: remote.expiry_date || null,
      notes: remote.notes ?? "", terms: remote.terms ?? "", referenceNumber: remote.reference_number ?? null,
      totalCents: zohoRemoteTotalCents(remote),
      lines: zohoLines,
    },
  };
}

// Applies the reviewed Zoho document to the same CRM quotation row: same
// estimate ID and QT number, lines, prices, discounts, dates, notes, terms and
// a freshly stored PDF. Nothing is written back to Zoho and no mark-sent call
// is made; an unsent quotation stays zoho_draft for Confirm quotation sent,
// and a previously-sent one keeps its sent attribution.
export async function adoptZohoQuotation(input: unknown) {
  const parsed = reviewedZohoQuotationSchema.parse(input);
  const { session, order, row: seed, link } = await reviewedLinkedQuotation(parsed.quotationId);
  if (new Date(seed.updated_at).toISOString() !== parsed.expectedUpdatedAt) {
    throw new UserFacingError("This quotation changed since it was previewed. Review it again.");
  }
  const claimToken = randomUUID();
  const claimed = await db.updateTable("order_quotations").set({ status: "syncing", sync_error: null, sync_claim_token: claimToken, sync_claimed_at: new Date() })
    .where("id", "=", seed.id)
    .where(sql<boolean>`date_trunc('milliseconds', updated_at) = ${seed.updated_at}`)
    .where("status", "in", [...REVIEWABLE_STATUSES])
    .returning("id").executeTakeFirst();
  if (!claimed) throw new UserFacingError("Quotation changed or is already being processed. Refresh and try again.");
  const restoreStatus = seed.status;
  const previouslySentAdopt = seed.sent_at !== null;
  try {
    const remote = await checkedLinkedRemote(seed, link.zoho_contact_id);
    if (zohoAdoptionFingerprint(remote as unknown as Record<string, unknown>) !== parsed.remoteFingerprint) {
      throw new UserFacingError("The Zoho quotation changed since it was previewed. Review it again.");
    }
    if (!isValidZohoDate(remote.date) || Boolean(remote.expiry_date && (!isValidZohoDate(remote.expiry_date) || remote.expiry_date < remote.date))) {
      throw new UserFacingError("The Zoho quotation dates are incomplete or invalid");
    }
    const issues = zohoAdoptionIssues(remote);
    if (issues.length > 0) throw new UserFacingError(`The Zoho quotation cannot be adopted because ${issues.join("; ")}.`);
    const lines = zohoValidatedLines(remote);
    if (lines.length === 0) throw new UserFacingError("The Zoho quotation lines cannot be represented in the CRM; check line names, quantities, rates and discounts");
    if (!adoptedTotalMatches(lines, remote)) {
      throw new UserFacingError("The Zoho line items do not add up to the Zoho total; reconcile it in Zoho Books first");
    }
    const totalCents = zohoRemoteTotalCents(remote);
    const issueDate = remote.date;
    const expiryDate = remote.expiry_date || null;
    const pdf = await storePdf({ ...seed, zoho_estimate_id: remote.estimate_id });
    // Re-read before finalizing: if Zoho moved between the preview-bound fetch
    // and the PDF download, the stored PDF must not describe a different
    // version than the adopted data.
    const remoteAfter = await getZohoEstimate(remote.estimate_id);
    if (zohoAdoptionFingerprint(remoteAfter as unknown as Record<string, unknown>) !== parsed.remoteFingerprint) {
      throw new UserFacingError("The Zoho quotation changed while its PDF was being fetched. Review it again.");
    }
    const previouslySent = seed.sent_at !== null;
    const displayIds = [order.order_reference || order.display_id, remote.estimate_number, seed.zoho_estimate_number].filter((value): value is string => Boolean(value));
    // A consultant-written message is kept verbatim; a generated one is
    // regenerated so the amount and validity it quotes stay correct.
    const keepMessage = Boolean(seed.customer_message) && !isGeneratedCustomerMessage(seed.customer_message, {
      customerName: order.customer_name, totalCents: seed.quoted_total_cents, expiryDate: quotationDateOnly(seed.expiry_date),
    }, displayIds);
    const finalized = await db.transaction().execute(async (trx) => {
      const locked = await trx.selectFrom("orders").select("current_status").where("id", "=", seed.order_id).forUpdate().executeTakeFirstOrThrow();
      assertQuotationStage(locked.current_status);
      const done = await trx.updateTable("order_quotations").set({
        status: previouslySent ? "sent" : "zoho_draft",
        issue_date: issueDate, expiry_date: expiryDate, lines: JSON.stringify(lines) as Json, quoted_total_cents: totalCents,
        customer_message: keepMessage ? seed.customer_message : defaultCustomerMessage({ customerName: order.customer_name, displayId: remote.estimate_number || order.display_id, totalCents, expiryDate }),
        notes: remote.notes ?? null, terms: remote.terms ?? null,
        zoho_contact_id: link.zoho_contact_id, zoho_estimate_number: remote.estimate_number, zoho_status: remote.status,
        zoho_last_modified_time: remote.last_modified_time ?? null,
        synced_payload_hash: estimateSnapshotHash(remote as unknown as Record<string, unknown>),
        pdf_storage_path: pdf.path, pdf_sha256: pdf.hash, synced_at: new Date(), sync_error: null,
        sync_claim_token: null, sync_claimed_at: null, updated_by: session.user.id,
      }).where("id", "=", seed.id).where("status", "=", "syncing").where("sync_claim_token", "=", claimToken).returning("id").executeTakeFirst();
      if (!done) return done;
      if (previouslySent) {
        const latest = await trx.selectFrom("order_quotation_versions").select((eb) => eb.fn.max("version").as("max_version")).where("quotation_id", "=", seed.id).executeTakeFirst();
        await trx.insertInto("order_quotation_versions").values({
          quotation_id: seed.id, version: Number(latest?.max_version ?? 0) + 1, lines: JSON.stringify(lines) as Json,
          quoted_total_cents: totalCents, pdf_storage_path: pdf.path, created_by: session.user.id,
        }).execute();
        await applyQuotedPrice(trx, { orderId: seed.order_id, totalCents, lines });
      }
      await trx.insertInto("order_status_events").values({
        order_id: seed.order_id, status: locked.current_status,
        note: `Quotation ${remote.estimate_number ?? ""}: used the Zoho details — the CRM draft was replaced from Zoho Books (Zoho status: ${remote.status})`.trim(),
        created_by: session.user.id,
      }).execute();
      return done;
    });
    if (!finalized) throw new UserFacingError("Quotation changed while the Zoho details were being adopted. Review it again.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "The Zoho quotation could not be adopted";
    await db.updateTable("order_quotations").set({ status: restoreStatus, sync_error: message, sync_claim_token: null, sync_claimed_at: null })
      .where("id", "=", seed.id).where("status", "=", "syncing").where("sync_claim_token", "=", claimToken).execute();
    throw error;
  } finally {
    revalidatePath(`/orders/${seed.order_id}`);
    // Adoption of a previously-sent quotation propagates its new total onto
    // the order and the lead, so both lists refresh too.
    if (previouslySentAdopt) { revalidatePath("/orders"); revalidatePath("/leads"); }
  }
}

/** Retired snapshot-import entry point: reject stale clients without mutations. */
export async function reconcileInvoicedZohoQuotation(input: unknown) {
  void input;
  await requireSession();
  throw new UserFacingError("Quotation imports stop once an invoice exists. Use the order's deposit action to verify the existing invoice and payment against the CRM order total. No records were changed.");
}

// The reviewed overwrite: the CRM side wins, pushed to the same Zoho estimate
// in one atomic claim of the previewed row — no reset-then-sync window in
// which an unpreviewed save could slip through. The remote fingerprint is
// re-verified immediately before the push, and the reviewed binding is what
// lets a conflicted or sent row be claimed here at all.
export async function overwriteZohoWithCrmQuotation(input: unknown) {
  const parsed = reviewedZohoQuotationSchema.parse(input);
  const { row, link } = await reviewedLinkedQuotation(parsed.quotationId);
  if (new Date(row.updated_at).toISOString() !== parsed.expectedUpdatedAt) {
    throw new UserFacingError("This quotation changed since it was previewed. Review it again.");
  }
  const remote = await checkedLinkedRemote(row, link.zoho_contact_id);
  if (zohoAdoptionFingerprint(remote as unknown as Record<string, unknown>) !== parsed.remoteFingerprint) {
    throw new UserFacingError("The Zoho quotation changed since it was previewed. Review it again before overwriting.");
  }
  await syncQuotationInternal(row.id, {
    expectedUpdatedAt: parsed.expectedUpdatedAt,
    remoteFingerprint: parsed.remoteFingerprint,
    auditNote: "overwrote Zoho Books with the saved CRM quotation after reviewing the differences",
  });
  revalidatePath(`/orders/${row.order_id}`);
}

export async function reconcileUncertainQuotation(quotationId: string) {
  const id = quotationIdSchema.parse(quotationId);
  const row = await db.selectFrom("order_quotations").selectAll().where("id", "=", id).executeTakeFirst();
  if (!row || row.status !== "conflict" || row.zoho_estimate_id) throw new UserFacingError("This quotation does not have an uncertain Zoho creation to check");
  await authorizedOrder(row.order_id, true);
  const matches = await findZohoEstimatesByCrmQuoteKey(row.crm_quote_key);
  if (matches.length > 1) throw new UserFacingError("Multiple Zoho quotations have this CRM Quote Key; an admin must reconcile them in Zoho Books");
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
  if (!row || (row.status !== "syncing" && row.status !== "sending")) throw new UserFacingError("This quotation has no active operation to recover");
  await authorizedOrder(row.order_id, true);
  if (!row.sync_claimed_at || new Date(row.sync_claimed_at).getTime() > Date.now() - 5 * 60_000) throw new UserFacingError("Zoho is still processing this operation. Try again in a few minutes.");
  if (!row.zoho_estimate_id) {
    await db.updateTable("order_quotations").set({ status: "local_draft", sync_claim_token: null, sync_claimed_at: null, sync_error: "Recovered an interrupted Zoho operation; sync again." }).where("id", "=", id).where("sync_claim_token", "=", row.sync_claim_token).execute();
  } else {
    const remote = await getZohoEstimate(row.zoho_estimate_id);
    const nextStatus = row.status === "sending" && remote.status === "draft" ? "zoho_draft"
      : row.status === "syncing" && row.sent_at && remote.status !== "invoiced" ? "local_draft"
      : "conflict";
    await db.updateTable("order_quotations").set({ status: nextStatus, zoho_status: remote.status, zoho_last_modified_time: remote.last_modified_time ?? null, sync_claim_token: null, sync_claimed_at: null, sync_error: nextStatus === "conflict" ? "Interrupted operation reconciled with Zoho; review the remote state." : null }).where("id", "=", id).where("sync_claim_token", "=", row.sync_claim_token).execute();
  }
  revalidatePath(`/orders/${row.order_id}`);
}

// Keeps the order list and the lead funnel on the latest quoted total.
async function applyQuotedPrice(trx: Transaction<DB>, input: { orderId: string; totalCents: number; lines: QuotationLineInput[] }) {
  const now = new Date();
  const order = await trx.selectFrom("orders").select(["lead_id", "appointment_id"]).where("id", "=", input.orderId).forUpdate().executeTakeFirstOrThrow();
  await trx.updateTable("orders").set({ price_quoted_cents: input.totalCents, updated_at: now }).where("id", "=", input.orderId).execute();
  const lead = await resolveLeadForOrderSync(trx, { lead_id: order.lead_id, appointment_id: order.appointment_id });
  if (lead) await trx.updateTable("leads").set({ latest_quote_cents: input.totalCents, quotation_breakdown: quotationBreakdown(input.lines), updated_at: now }).where("id", "=", lead.id).execute();
}

export async function confirmQuotationSent(input: unknown) {
  const parsed = sendQuotationSchema.parse(input);
  const row = await db.selectFrom("order_quotations").selectAll().where("id", "=", parsed.quotationId).executeTakeFirst();
  if (!row) throw new UserFacingError("Quotation not found");
  if (row.sent_at) throw new UserFacingError("This quotation has already been sent. Sync your changes to update it.");
  const { session, order } = await authorizedOrder(row.order_id, true);
  if (order.current_status !== "order_recorded" && order.current_status !== "quotation_sent") throw new UserFacingError("This order is no longer at the quotation stage");
  if (row.status !== "zoho_draft" || !row.zoho_estimate_id || !row.synced_payload_hash || !row.pdf_storage_path || !row.pdf_sha256) throw new UserFacingError("Sync and preview the latest quotation before confirming it sent");
  const remote = await getZohoEstimate(row.zoho_estimate_id);
  if (remote.last_modified_time && remote.last_modified_time !== row.zoho_last_modified_time) {
    await db.updateTable("order_quotations").set({ status: "conflict", sync_error: "Zoho changed after the last preview" }).where("id", "=", row.id).execute();
    throw new UserFacingError("Zoho changed after the last preview. Reconcile before sending.");
  }
  const sendClaimToken = randomUUID();
  await db.transaction().execute(async (trx) => {
    const locked = await trx.selectFrom("orders").select(["current_status", "lead_id", "appointment_id"]).where("id", "=", row.order_id).forUpdate().executeTakeFirstOrThrow();
    if (locked.current_status !== "order_recorded" && locked.current_status !== "quotation_sent") throw new UserFacingError("This order is no longer at the quotation stage");
    const claimed = await trx.updateTable("order_quotations").set({ status: "sending", sync_error: null, sync_claim_token: sendClaimToken, sync_claimed_at: new Date() })
      .where("id", "=", row.id)
      .where("status", "=", "zoho_draft")
      .where(sql<boolean>`date_trunc('milliseconds', updated_at) = ${row.updated_at}`)
      .returning("id").executeTakeFirst();
    if (!claimed) throw new UserFacingError("Quotation changed or is already being sent. Refresh and try again.");
  });
  try {
    if (remote.status === "draft") await markZohoEstimateSent(row.zoho_estimate_id);
    else if (remote.status !== "sent") throw new UserFacingError(`Zoho quotation is already ${remote.status}`);
    const afterSend = await getZohoEstimate(row.zoho_estimate_id);
    await db.transaction().execute(async (trx) => {
      const locked = await trx.selectFrom("orders").select(["current_status", "lead_id", "appointment_id"]).where("id", "=", row.order_id).forUpdate().executeTakeFirstOrThrow();
      if (locked.current_status !== "order_recorded" && locked.current_status !== "quotation_sent") throw new UserFacingError("This order changed while the quotation was being sent");
    const sentAt = new Date();
      const sentQuote = await trx.updateTable("order_quotations").set({ status: "sent", zoho_status: "sent", sent_at: sentAt, sent_by: session.user.id, sent_channel: parsed.channel, sent_note: parsed.note || null, zoho_last_modified_time: afterSend.last_modified_time ?? null, sync_claim_token: null, sync_claimed_at: null }).where("id", "=", row.id).where("status", "=", "sending").where("sync_claim_token", "=", sendClaimToken).returning("id").executeTakeFirst();
      if (!sentQuote) throw new UserFacingError("Quotation changed while it was being sent");
      await trx.insertInto("order_quotation_versions").values({
        quotation_id: row.id, version: 1, lines: JSON.stringify(linesOf(row)) as Json,
        quoted_total_cents: row.quoted_total_cents, pdf_storage_path: row.pdf_storage_path!, created_by: session.user.id,
      }).execute();
      await trx.updateTable("orders").set({ price_quoted_cents: row.quoted_total_cents, updated_at: sentAt }).where("id", "=", row.order_id).execute();
    if (locked.current_status === "order_recorded") {
      await trx.insertInto("order_status_events").values({ order_id: row.order_id, status: "quotation_sent", note: `Quotation ${row.zoho_estimate_number ?? ""} sent via ${parsed.channel}`.trim(), created_by: session.user.id }).execute();
      const lead = await resolveLeadForOrderSync(trx, { lead_id: locked.lead_id, appointment_id: locked.appointment_id });
      if (lead) {
        const milestone = leadMilestoneForOrderStatus("quotation_sent");
        if (milestone) {
          const validityDays = row.expiry_date
            ? Math.max(1, Math.round((new Date(String(row.expiry_date)).getTime() - new Date(String(row.issue_date)).getTime()) / 86_400_000))
            : null;
          const breakdown = quotationBreakdown(linesOf(row));
          // A quotation without an expiry leaves leads.quote_valid_days at its
          // existing value so the funnel's quote-aged nudge keeps working.
          await trx.updateTable("leads").set({ funnel_stage: milestone.stage, last_outcome: milestone.outcome, quotation_sent_at: sentAt, latest_quote_cents: row.quoted_total_cents, quotation_breakdown: breakdown, updated_at: sentAt, ...(validityDays === null ? {} : { quote_valid_days: validityDays }) }).where("id", "=", lead.id).execute();
          if (lead.funnel_stage !== milestone.stage) await trx.insertInto("lead_stage_events").values({ lead_id: lead.id, from_stage: lead.funnel_stage, to_stage: milestone.stage, changed_at: sentAt, changed_by: session.user.id, source: "system" }).execute();
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

async function importExistingZohoQuotationInternal(input: unknown) {
  const parsed = importZohoQuotationSchema.parse(input);
  const row = await db.selectFrom("order_quotations").selectAll().where("id", "=", parsed.quotationId).executeTakeFirst();
  if (!row) throw new UserFacingError("Quotation not found");
  const { order } = await authorizedOrder(row.order_id, true);
  if (order.current_status !== "order_recorded") throw new UserFacingError("Existing quotations can only be imported at Order Recorded");
  if (row.zoho_estimate_id || row.status !== "local_draft") throw new UserFacingError("This CRM quotation is already linked to Zoho");
  const link = await db.selectFrom("customer_zoho_links").select("zoho_contact_id").where("customer_id", "=", order.customer_id).executeTakeFirst();
  if (!link) throw new UserFacingError("Confirm the matching Zoho customer first");

  const matches = await findZohoEstimateByNumber(parsed.estimateNumber);
  if (matches.length !== 1) throw new UserFacingError(matches.length === 0 ? "That Zoho quotation was not found" : "Multiple Zoho quotations matched that number");
  const remote = await getZohoEstimate(matches[0].estimate_id);
  if (remote.customer_id !== link.zoho_contact_id) throw new UserFacingError("The Zoho quotation belongs to a different customer");
  if (remote.currency_code !== "SGD") throw new UserFacingError("Only SGD quotations can be imported");
  if (remote.status !== "draft" && remote.status !== "sent") throw new UserFacingError(`Zoho quotation is already ${remote.status}`);
  if (!remote.date || (remote.expiry_date && remote.expiry_date < remote.date)) throw new UserFacingError("The Zoho quotation dates are incomplete");
  const importedIssueDate = remote.date;
  const importedExpiryDate = remote.expiry_date || null;
  const totalCents = Math.round(Number(remote.total) * 100);
  if (!Number.isFinite(totalCents) || totalCents < 0) throw new UserFacingError("The Zoho quotation total is invalid");
  const lines = quotationLineSchema.array().min(1).parse((remote.line_items ?? []).map((line) => ({
    zohoItemId: line.item_id || null,
    name: line.name || "Zoho item",
    description: line.description ?? "",
    quantity: Number(line.quantity),
    rateCents: Math.round(Number(line.rate) * 100),
    discountPercent: Number.parseFloat(String(line.discount ?? 0)) || 0,
  })));
  const alreadyLinked = await db.selectFrom("order_quotations").select("order_id").where("zoho_estimate_id", "=", remote.estimate_id).executeTakeFirst();
  if (alreadyLinked) throw new UserFacingError("That Zoho quotation is already linked to another CRM order");
  const remoteKey = await crmKeyOf(remote);
  if (remoteKey && remoteKey !== row.crm_quote_key) throw new UserFacingError("That Zoho quotation is linked to a different CRM quotation");
  const pdf = await storePdf({ ...row, zoho_estimate_id: remote.estimate_id });
  const imported = await db.updateTable("order_quotations").set({
    status: "zoho_draft",
    issue_date: importedIssueDate,
    expiry_date: importedExpiryDate,
    lines: JSON.stringify(lines) as Json,
    quoted_total_cents: totalCents,
    customer_message: defaultCustomerMessage({
      customerName: order.customer_name,
      displayId: remote.estimate_number,
      totalCents,
      expiryDate: importedExpiryDate,
    }),
    notes: remote.notes ?? null,
    terms: remote.terms ?? null,
    zoho_contact_id: link.zoho_contact_id,
    zoho_estimate_id: remote.estimate_id,
    zoho_estimate_number: remote.estimate_number,
    zoho_status: remote.status,
    zoho_last_modified_time: remote.last_modified_time ?? null,
    synced_payload_hash: estimateSnapshotHash(remote as unknown as Record<string, unknown>),
    pdf_storage_path: pdf.path,
    pdf_sha256: pdf.hash,
    synced_at: new Date(),
    sync_error: null,
  }).where("id", "=", row.id).where("status", "=", "local_draft").where("zoho_estimate_id", "is", null).returning("id").executeTakeFirst();
  if (!imported) throw new UserFacingError("The CRM quotation changed while it was being imported");
  await confirmQuotationSent({ quotationId: row.id, channel: parsed.channel, note: parsed.note });
}

export async function importExistingZohoQuotation(input: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await importExistingZohoQuotationInternal(input);
    return { ok: true };
  } catch (error) {
    // Next.js redacts errors thrown by Server Actions in production. Return the
    // intentionally user-facing integration error so the consultant can act on
    // the real Zoho mismatch instead of seeing an opaque render digest.
    const message = error instanceof Error ? error.message : "The Zoho quotation could not be imported";
    console.error("Zoho quotation import failed", error);
    return { ok: false, error: message };
  }
}

export async function createQuotationRevision(quotationId: string) {
  const id = quotationIdSchema.parse(quotationId);
  const source = await db.selectFrom("order_quotations").selectAll().where("id", "=", id).executeTakeFirst();
  if (!source) throw new UserFacingError("Quotation not found");
  const { session } = await authorizedOrder(source.order_id, true);
  const order = await db.selectFrom("orders").select("current_status").where("id", "=", source.order_id).executeTakeFirstOrThrow();
  if (order.current_status !== "order_recorded" && order.current_status !== "quotation_sent") throw new UserFacingError("Revisions can only be created during the quotation stage");
  if (source.status !== "sent") throw new UserFacingError("Only a sent quotation needs a revision");
  const nextId = randomUUID();
  await db.transaction().execute(async (trx) => {
    const lockedOrder = await trx.selectFrom("orders").select("current_status").where("id", "=", source.order_id).forUpdate().executeTakeFirstOrThrow();
    if (lockedOrder.current_status !== "order_recorded" && lockedOrder.current_status !== "quotation_sent") throw new UserFacingError("Revisions can only be created during the quotation stage");
    const locked = await trx.selectFrom("order_quotations").selectAll().where("id", "=", id).forUpdate().executeTakeFirstOrThrow();
    if (locked.superseded_at || locked.status !== "sent") throw new UserFacingError("A revision already exists. Refresh and try again.");
    if (["pending", "uncertain"].includes(locked.invoice_sync_state) || locked.zoho_invoice_id) throw new UserFacingError("A revision cannot be created while an invoice is pending, uncertain, or already exists");
    const now = new Date();
    const issueDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Singapore", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
    // A sent quotation without an expiry stays without one in the revision;
    // inventing a validity window the Zoho document never had would misquote.
    let expiryDate: string | null = null;
    if (locked.expiry_date) {
      const expiry = new Date(`${issueDate}T00:00:00Z`); expiry.setUTCDate(expiry.getUTCDate() + 7);
      expiryDate = expiry.toISOString().slice(0, 10);
    }
    await trx.updateTable("order_quotations").set({ status: "superseded", superseded_at: now, superseded_by: session.user.id }).where("id", "=", id).execute();
    await trx.insertInto("order_quotations").values({ id: nextId, order_id: locked.order_id, revision: locked.revision + 1, crm_quote_key: `dw:${locked.order_id}:v${locked.revision + 1}:${nextId}`, issue_date: issueDate, expiry_date: expiryDate, lines: JSON.stringify(locked.lines) as Json, quoted_total_cents: locked.quoted_total_cents, customer_message: locked.customer_message, notes: locked.notes, terms: locked.terms, status: "local_draft", created_by: session.user.id, updated_by: session.user.id }).execute();
  });
  revalidatePath(`/orders/${source.order_id}`);
  return { id: nextId };
}

export type InvoicePaymentReceipt = {
  quotationId: string; invoiceId: string; paymentId: string; orderTotalCents: number; depositCents: number; commercialFingerprint: string;
};

// Retired financial entry point: stale clients cannot convert estimates or write
// invoice/payment links in historical quotation storage.
export async function ensureZohoInvoiceForOrder(orderId: string, options?: { recoverExistingInvoice?: boolean; reuseOnly?: boolean; expectedPaymentId?: string }): Promise<InvoicePaymentReceipt> {
  await requireRole(["ops", "admin"]);void orderId;void options;
  throw new UserFacingError("Open the current order invoice workspace to verify invoice items and deposit.");
}

// Server Action errors are redacted to a digest in production, so the deposit
// dialog cannot catch a thrown message. This wrapper returns the deliberate
// user-facing message instead; anything unexpected is logged and genericised.
export async function ensureZohoInvoiceForOrderUi(orderId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await ensureZohoInvoiceForOrder(orderId);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: actionErrorMessage(error, "The Zoho invoice and deposit could not be recorded. Refresh the order and try again.") };
  }
}

// UI entry points. Production Next.js redacts thrown errors to a digest, so the
// quotation card calls these and toasts result.error. The throwing versions
// stay for server-side callers and tests.
export async function saveQuotationUi(input: unknown) {
  return toActionResult(() => saveQuotation(input), "The quotation could not be saved. Refresh and try again.");
}
export async function syncQuotationUi(quotationId: string) {
  return toActionResult(() => syncQuotation(quotationId), "Zoho could not be updated. Refresh and try again.");
}
export async function confirmQuotationSentUi(input: unknown) {
  return toActionResult(() => confirmQuotationSent(input), "The quotation could not be marked as sent. Refresh and try again.");
}
export async function acknowledgeZohoConflictUi(quotationId: string) {
  return toActionResult(() => acknowledgeZohoConflict(quotationId), "The quotation could not be reconciled with Zoho. Refresh and try again.");
}
export async function previewQuotationZohoDiffUi(quotationId: string) {
  return toActionResult(() => previewQuotationZohoDiff(quotationId), "The Zoho quotation details could not be loaded. Refresh and try again.");
}
export async function adoptZohoQuotationUi(input: unknown) {
  return toActionResult(() => adoptZohoQuotation(input), "The Zoho details could not be applied. Refresh and try again.");
}
export async function reconcileInvoicedZohoQuotationUi(input: unknown) {
  return toActionResult(() => reconcileInvoicedZohoQuotation(input), "The existing invoice could not be reconciled. Refresh and try again.");
}
export async function overwriteZohoWithCrmQuotationUi(input: unknown) {
  return toActionResult(() => overwriteZohoWithCrmQuotation(input), "Zoho could not be updated. Refresh and try again.");
}
export async function reconcileUncertainQuotationUi(quotationId: string) {
  return toActionResult(() => reconcileUncertainQuotation(quotationId), "Zoho could not be checked. Refresh and try again.");
}
export async function recoverStaleQuotationClaimUi(quotationId: string) {
  return toActionResult(() => recoverStaleQuotationClaim(quotationId), "The Zoho operation could not be checked. Refresh and try again.");
}
export async function getQuotationPdfUrlUi(quotationId: string, download = false) {
  return toActionResult(() => getQuotationPdfUrl(quotationId, download), "Could not open the quotation PDF.");
}
export async function getZohoQuotationOptionsUi(orderId: string) {
  return toActionResult(() => getZohoQuotationOptions(orderId), "Could not load Zoho Books.");
}
export async function searchZohoCustomersUi(orderId: string, query: string) {
  return toActionResult(() => searchZohoCustomers(orderId, query), "Zoho customer search failed.");
}
export async function confirmZohoCustomerUi(input: unknown) {
  return toActionResult(() => confirmZohoCustomer(input), "The Zoho customer could not be confirmed.");
}
export async function createAndConfirmZohoCustomerUi(orderId: string) {
  return toActionResult(() => createAndConfirmZohoCustomer(orderId), "The Zoho customer could not be created. Refresh and check for the customer before trying again.");
}
