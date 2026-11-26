"use server";
import "server-only";
import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/kysely";
import { requireSession, requireRole } from "@/lib/auth/require-role";
import { getZohoEstimate, getZohoInvoice, getZohoBooksBinding, getZohoDepositPaymentConfig, listZohoCustomerPayments, getZohoCustomerPayment, updateZohoInvoiceCommercial } from "@/lib/zoho/books";
import { commercialEqual, commercialUpdateLines, commercialWriteIssues, commercialFromQuotation, invoiceUpdateIssues, normalizeCommercialInvoice, type CommercialInvoice } from "@/lib/quotations/commercial-invoice";
import { loadCommercialSnapshot, persistCommercialSnapshot } from "@/lib/quotations/commercial-store";
import { quotePayloadHash } from "@/lib/quotations/hash";
import { crmKeyConflicts } from "@/lib/quotations/lifecycle";
import { optionalMoneyCents } from "@/lib/quotations/invoice-reconciliation";
import type { QuotationLineInput } from "@/lib/validation/quotation";
import { toActionResult, UserFacingError } from "@/lib/user-facing-error";
import { verifyExistingDepositPayment } from "@/lib/quotations/deposit-verification";
import { ensureZohoInvoiceForOrder } from "./quotations";
import { advanceOrderStatus } from "./status";
import { resolveLeadForOrderSync } from "./order-customer";
import { leadMilestoneForOrderStatus } from "@/lib/status-flow";

class NoExistingInvoice extends UserFacingError {
  constructor(readonly review: { orderId: string; fingerprint: string; orderStage: string; orderTotalCents: number; depositCents: number; historicalQuoteTotalCents: number; admin: boolean; operator: boolean; canConfirmDeposit: boolean }) { super("No existing Zoho invoice is linked. Use the validated quotation-to-invoice flow."); }
}
const reviewSchema = z.object({ orderId: z.string().uuid(), fingerprint: z.string().min(1), choice: z.enum(["match", "zoho", "crm"]).optional(), confirm: z.boolean().optional(), reuseOnly: z.boolean().optional(), paymentId: z.string().min(1).max(200).optional() });
async function context(orderId: string) {
  const session = await requireSession();
  const order = await db.selectFrom("orders").select(["id", "current_status", "price_quoted_cents", "deposit_cents", "consultant_id", "display_id", "is_draft", "lead_id", "appointment_id"]).where("id", "=", orderId).executeTakeFirstOrThrow();
  const admin = session.profile.role === "admin", operator = admin || session.profile.role === "ops";
  if (!operator && !(session.profile.role === "consultant" && order.consultant_id === session.user.id)) throw new UserFacingError("Forbidden");
  const quote = await db.selectFrom("order_quotations").selectAll().where("order_id", "=", orderId).where("superseded_at", "is", null).executeTakeFirst();
  if (!quote?.zoho_estimate_id || !quote.zoho_contact_id) throw new UserFacingError("The current quotation needs a verified Zoho customer and estimate link.");
  const remoteEstimate = await getZohoEstimate(quote.zoho_estimate_id);
  const binding = await getZohoBooksBinding();
  const key = remoteEstimate.custom_fields?.find(field => field.customfield_id === binding.crmKeyFieldId || field.api_name === binding.crmKeyApiName || field.label === "CRM Quote Key")?.value;
  if (remoteEstimate.estimate_id !== quote.zoho_estimate_id || remoteEstimate.customer_id !== quote.zoho_contact_id || remoteEstimate.currency_code !== "SGD" || crmKeyConflicts(key, quote.crm_quote_key) || (quote.zoho_invoice_id && remoteEstimate.invoice_ids?.[0] !== quote.zoho_invoice_id)) throw new UserFacingError("Exactly one existing invoice must be linked to this quotation and customer. Check the document links in Zoho.");
  if (!quote.zoho_invoice_id && !remoteEstimate.invoice_ids?.length && remoteEstimate.status !== "invoiced") throw new NoExistingInvoice({ orderId, fingerprint: quotePayloadHash({ order, quote: quote.updated_at, estimate: remoteEstimate }), orderStage: order.current_status, orderTotalCents: order.price_quoted_cents, depositCents: order.deposit_cents, historicalQuoteTotalCents: quote.quoted_total_cents, admin, operator, canConfirmDeposit: operator && !order.is_draft && order.current_status === "quotation_sent" });
  if (remoteEstimate.invoice_ids?.length !== 1) throw new UserFacingError("Zoho has no single authoritative invoice link. Resolve the existing invoice links before continuing; no replacement will be created.");
  const invoice = await getZohoInvoice(remoteEstimate.invoice_ids[0]);
  if (invoice.invoice_id !== remoteEstimate.invoice_ids[0] || invoice.customer_id !== quote.zoho_contact_id || invoice.currency_code !== "SGD" || !["draft", "sent", "overdue", "paid", "partially_paid"].includes(invoice.status ?? "")) throw new UserFacingError("The existing invoice identity, customer, currency or status is not valid for this order.");
  const snapshot = await loadCommercialSnapshot(orderId);
  if (snapshot && (snapshot.invoice_id !== invoice.invoice_id || snapshot.quotation_id !== quote.id)) throw new UserFacingError("The saved commercial record belongs to a different document. Ask an admin to review the links.");
  let crm: CommercialInvoice | null = null, zoho: CommercialInvoice | null = null;
  const issues: string[] = [];
  try { crm = snapshot?.document ?? commercialFromQuotation(quote.lines as unknown as QuotationLineInput[], quote.quoted_total_cents); } catch (error) { issues.push(`CRM: ${error instanceof Error ? error.message : "Invalid commercial items"}`); }
  try { zoho = normalizeCommercialInvoice(invoice); } catch (error) { issues.push(`Zoho: ${error instanceof Error ? error.message : "Invalid invoice items"}`); }
  const equal = Boolean(crm && zoho && crm.totalCents === order.price_quoted_cents && commercialEqual(crm, zoho));
  const freshClaim = (state: string, claimedAt: Date | null) => state === "pending" && (!claimedAt || new Date(claimedAt).getTime() > Date.now() - 120000);
  const busy = ["syncing", "sending"].includes(quote.status) || freshClaim(quote.invoice_sync_state, quote.invoice_claimed_at) || freshClaim(quote.payment_sync_state, quote.payment_claimed_at) || Boolean(snapshot?.state === "updating" && new Date(snapshot.updated_at).getTime() > Date.now() - 120000);
  const mutationBlocked = ["pending", "uncertain"].includes(quote.invoice_sync_state) || ["pending", "uncertain"].includes(quote.payment_sync_state);
  const fingerprint = quotePayloadHash({ order, quoteId: quote.id, quoteUpdated: quote.updated_at, invoice, estimate: remoteEstimate, snapshot });
  return { session, order, quote, invoice, snapshot, crm, zoho, equal, busy, mutationBlocked, fingerprint, issues, admin, operator };
}
export async function previewInvoiceReconciliation(orderId: string) {
  await requireSession();
  let c: Awaited<ReturnType<typeof context>>;
  try { c = await context(z.string().uuid().parse(orderId)); }
  catch (error) {
    if (!(error instanceof NoExistingInvoice)) throw error;
    return { ...error.review, hasInvoice: false, crm: null, zoho: null, equal: false, issues: [], busy: false, mutationBlocked: false, sourceAllowed: false, invoiceId: null, invoiceNumber: null, invoiceStatus: null, basis: "Quotation items", synced: false, verifiedPaymentId: null, paymentCheckError: null, paymentVerified: false, canRecordDeposit: false, paymentState: "not_started", paidCents: null, balanceCents: null, creditsCents: null, updateIssues: [] };
  }
  let verifiedPaymentId: string | null = null, paymentCheckError: string | null = null;
  try {
    if (c.order.deposit_cents > 0) {
      const config = getZohoDepositPaymentConfig();
      verifiedPaymentId = (await verifyExistingDepositPayment({ customerId: c.quote.zoho_contact_id!, invoiceId: c.invoice.invoice_id, invoiceNumber: c.invoice.invoice_number ?? null, amountCents: c.order.deposit_cents, referenceNumber: `CRM-${c.order.display_id}-DEPOSIT`, accountId: config.accountId, storedPaymentId: c.quote.zoho_payment_id }))?.payment_id ?? null;
    }
  } catch (error) { paymentCheckError = error instanceof UserFacingError ? error.message : "The existing deposit payment could not be verified. Retry the Zoho check."; }
  if (!verifiedPaymentId && !paymentCheckError && (c.order.deposit_cents <= 0 || !["draft", "sent", "overdue"].includes(c.invoice.status ?? "") || optionalMoneyCents(c.invoice.payment_made) !== 0 || optionalMoneyCents(c.invoice.credits_applied) !== 0 || optionalMoneyCents(c.invoice.balance) !== optionalMoneyCents(c.invoice.total))) paymentCheckError = "Zoho shows payment activity or incomplete payment information, but no matching deposit was verified. Retry or reconcile the existing payments in Zoho; no new payment will be created from this check.";
  return { orderId, hasInvoice: true, sourceAllowed: ["order_recorded", "quotation_sent", "deposit_received"].includes(c.order.current_status), fingerprint: c.fingerprint, crm: c.crm, zoho: c.zoho, equal: c.equal, issues: c.issues, busy: c.busy, mutationBlocked: c.mutationBlocked, admin: c.admin, operator: c.operator,
    invoiceId: c.invoice.invoice_id, invoiceNumber: c.invoice.invoice_number ?? c.invoice.invoice_id, invoiceStatus: c.invoice.status,
    orderStage: c.order.current_status, orderTotalCents: c.order.price_quoted_cents, depositCents: c.order.deposit_cents,
    historicalQuoteTotalCents: c.quote.quoted_total_cents, basis: c.snapshot ? "Current commercial invoice details" : "Quotation items (initial commercial basis)",
    synced: c.equal, verifiedPaymentId, paymentVerified: Boolean(verifiedPaymentId), paymentCheckError, canRecordDeposit: !verifiedPaymentId && !paymentCheckError,
    paymentState: c.quote.payment_sync_state, paidCents: optionalMoneyCents(c.invoice.payment_made), balanceCents: optionalMoneyCents(c.invoice.balance), creditsCents: optionalMoneyCents(c.invoice.credits_applied),
    updateIssues: [...(c.snapshot?.state === "uncertain" ? ["A previous update is unconfirmed. Verify matching details or use the current Zoho details before another update."] : []), ...invoiceUpdateIssues(c.invoice), ...commercialWriteIssues(c.crm), ...commercialWriteIssues(c.zoho), ...(!c.crm || c.crm.totalCents !== c.order.price_quoted_cents ? ["CRM commercial items do not equal the CRM order total. Use Zoho details or correct the commercial basis before updating Zoho."] : [])],
    canConfirmDeposit: c.operator && !c.order.is_draft && ["order_recorded", "quotation_sent", "deposit_received"].includes(c.order.current_status),
  };
}
export async function applyInvoiceReconciliation(input: unknown) {
  await requireSession();
  const parsed = reviewSchema.parse(input), c = await context(parsed.orderId);
  if (!["order_recorded", "quotation_sent", "deposit_received"].includes(c.order.current_status)) throw new UserFacingError("This order is past financial reconciliation. Commercial invoice details are read-only.");
  if (!c.operator || (parsed.choice !== "match" && !c.admin)) throw new UserFacingError("Only an admin can choose a financial source; operations users can verify matching details.");
  if (c.fingerprint !== parsed.fingerprint || c.busy || (c.mutationBlocked && parsed.choice !== "zoho") || c.order.is_draft) throw new UserFacingError("This review changed or an operation is in progress. Refresh and review again.");
  if (!parsed.choice || (parsed.choice === "match" ? !c.equal : !parsed.confirm)) throw new UserFacingError("Review and explicitly confirm the selected source.");
  const target = parsed.choice === "crm" ? c.crm : c.zoho;
  if (!target || target.totalCents < c.order.deposit_cents) throw new UserFacingError("The commercial total cannot be below the recorded CRM deposit or contain unsupported items.");
  if (parsed.choice === "crm" && (c.snapshot?.state === "uncertain" || invoiceUpdateIssues(c.invoice).length || commercialWriteIssues(target).length || commercialWriteIssues(c.zoho).length || target.totalCents !== c.order.price_quoted_cents || !c.zoho)) throw new UserFacingError("This invoice cannot safely be updated from CRM. Use Zoho invoice details instead.");
  const claim = randomUUID();
  await db.transaction().execute(async trx => {
    const order = await trx.selectFrom("orders").selectAll().where("id", "=", parsed.orderId).forUpdate().executeTakeFirstOrThrow();
    const quote = await trx.selectFrom("order_quotations").selectAll().where("id", "=", c.quote.id).forUpdate().executeTakeFirstOrThrow();
    const snapshot = await loadCommercialSnapshot(parsed.orderId, trx, true);
    if (order.current_status !== c.order.current_status || order.price_quoted_cents !== c.order.price_quoted_cents || order.deposit_cents !== c.order.deposit_cents || order.is_draft || quote.superseded_at || new Date(quote.updated_at).getTime() !== new Date(c.quote.updated_at).getTime() || (snapshot?.revision ?? 0) !== (c.snapshot?.revision ?? 0)) throw new UserFacingError("The CRM details changed. Refresh before applying.");
    await sql`insert into public.order_invoice_commercial(order_id,quotation_id,invoice_id,document,state,claim_token,updated_by) values(${parsed.orderId}::uuid,${quote.id}::uuid,${c.invoice.invoice_id},${JSON.stringify(c.crm ?? target)}::jsonb,'updating',${claim}::uuid,${c.session.user.id}::uuid)
      on conflict(order_id) do update set state='updating',claim_token=excluded.claim_token,revision=order_invoice_commercial.revision+1,updated_at=now()`.execute(trx);
  });
  try {
    // Recheck live identity/payment facts immediately before any PUT.
    if (parsed.choice === "crm") {
      for (const summary of await listZohoCustomerPayments(c.quote.zoho_contact_id!)) {
        const payment = await getZohoCustomerPayment(summary.payment_id);
        if (payment.payment_id !== summary.payment_id || payment.customer_id !== c.quote.zoho_contact_id || !Array.isArray(payment.invoices) || payment.invoices.some(allocation => allocation.invoice_id === c.invoice.invoice_id && Number(allocation.amount_applied) !== 0)) throw new UserFacingError("Payment allocations are present or unknown. Update is blocked; use Zoho invoice details in CRM.");
      }
    }
    const fresh = await getZohoInvoice(c.invoice.invoice_id);
    if (quotePayloadHash(fresh) !== quotePayloadHash(c.invoice)) throw new UserFacingError("Zoho changed after this review. Refresh; nothing was applied.");
    let result = fresh;
    if (parsed.choice === "crm") {
      if (invoiceUpdateIssues(fresh).length) throw new UserFacingError("The invoice now has payment activity or unknown amounts. Updating is blocked.");
      await db.transaction().execute(async trx => {
        const order = await trx.selectFrom("orders").selectAll().where("id", "=", parsed.orderId).forUpdate().executeTakeFirstOrThrow();
        const quote = await trx.selectFrom("order_quotations").selectAll().where("id", "=", c.quote.id).forUpdate().executeTakeFirstOrThrow();
        const snapshot = await loadCommercialSnapshot(parsed.orderId, trx, true);
        if (snapshot?.claim_token !== claim || snapshot.state !== "updating" || order.current_status !== c.order.current_status || order.price_quoted_cents !== c.order.price_quoted_cents || order.deposit_cents !== c.order.deposit_cents || order.is_draft || quote.superseded_at || new Date(quote.updated_at).getTime() !== new Date(c.quote.updated_at).getTime()) throw new UserFacingError("CRM changed during invoice review. No update was sent; refresh and compare again.");
      });
      try { await updateZohoInvoiceCommercial(fresh.invoice_id, commercialUpdateLines(target), fresh.customer_id!); }
      catch { /* A single uncertain PUT is reconciled by GET, never repeated. */ }
      result = await getZohoInvoice(fresh.invoice_id);
      if (result.invoice_id !== fresh.invoice_id || result.customer_id !== fresh.customer_id || result.currency_code !== "SGD" || result.invoice_number !== fresh.invoice_number || result.status !== fresh.status || invoiceUpdateIssues(result).length > 0 || !commercialEqual(normalizeCommercialInvoice(result), target)) throw new UserFacingError("Zoho update is unconfirmed. Refresh and review the existing invoice before any retry.");
    }
    await db.transaction().execute(async trx => {
      const order = await trx.selectFrom("orders").selectAll().where("id", "=", parsed.orderId).forUpdate().executeTakeFirstOrThrow();
      const quote = await trx.selectFrom("order_quotations").selectAll().where("id", "=", c.quote.id).forUpdate().executeTakeFirstOrThrow();
      const snapshot = await loadCommercialSnapshot(parsed.orderId, trx, true);
      if (snapshot?.claim_token !== claim || order.current_status !== c.order.current_status || order.price_quoted_cents !== c.order.price_quoted_cents || order.deposit_cents !== c.order.deposit_cents || quote.superseded_at || new Date(quote.updated_at).getTime() !== new Date(c.quote.updated_at).getTime()) throw new UserFacingError("CRM changed during reconciliation. Refresh before continuing.");
      if (parsed.choice === "zoho" && target.totalCents !== order.price_quoted_cents) await sql`select public.amend_order_payment(${parsed.orderId}::uuid,${target.totalCents}::integer,${order.deposit_cents}::integer,${c.session.user.id}::uuid)`.execute(trx);
      await persistCommercialSnapshot(trx, { orderId: parsed.orderId, quotationId: quote.id, invoiceId: result.invoice_id, document: target, actorId: c.session.user.id, remote: result, action: parsed.choice!, before: c.crm });
      await trx.updateTable("order_quotations").set({ zoho_invoice_id: result.invoice_id, zoho_invoice_number: result.invoice_number ?? null, invoice_created_at: quote.invoice_created_at ?? (result.created_time && Number.isFinite(new Date(result.created_time).getTime()) ? new Date(result.created_time) : new Date()), invoice_sync_state: "created", invoice_sync_error: null, invoice_claim_token: null, invoice_claimed_at: null }).where("id", "=", quote.id).execute();
      if (parsed.choice === "zoho") {
        const lead = await resolveLeadForOrderSync(trx, order);
        if (lead) await trx.updateTable("leads").set({ latest_quote_cents: target.totalCents, updated_at: new Date() }).where("id", "=", lead.id).execute();
      }
    });
  } catch (error) {
    await sql`update public.order_invoice_commercial set state='uncertain',claim_token=null,updated_at=now() where order_id=${parsed.orderId}::uuid and claim_token=${claim}::uuid`.execute(db);
    throw error;
  } finally { revalidatePath(`/orders/${parsed.orderId}`); revalidatePath("/orders"); }
}
export async function confirmInvoiceDeposit(input: unknown) {
  await requireRole(["ops", "admin"]);
  const parsed = reviewSchema.parse(input);
  let c: Awaited<ReturnType<typeof context>>;
  try { c = await context(parsed.orderId); }
  catch (error) {
    if (!(error instanceof NoExistingInvoice)) throw error;
    if (parsed.reuseOnly || !parsed.confirm || !error.review.canConfirmDeposit || error.review.fingerprint !== parsed.fingerprint) throw new UserFacingError("Refresh the quotation review and confirm the received deposit before creating an invoice.");
    return advanceOrderStatus({ orderId: parsed.orderId, expectedStatus: "quotation_sent", note: "Confirmed deposit receipt; validated sent quotation used to create the invoice where absent." });
  }
  await requireRole(["ops", "admin"]);
  if ((!parsed.confirm && !parsed.reuseOnly) || c.fingerprint !== parsed.fingerprint || !c.equal || c.busy || c.order.is_draft) throw new UserFacingError("Confirm receipt only after reviewing matching invoice details. Refresh if anything changed.");
  if (parsed.reuseOnly) {
    if (!parsed.paymentId) throw new UserFacingError("Refresh the payment check before continuing.");
    const config = getZohoDepositPaymentConfig();
    const payment = await verifyExistingDepositPayment({ customerId: c.quote.zoho_contact_id!, invoiceId: c.invoice.invoice_id, invoiceNumber: c.invoice.invoice_number ?? null, amountCents: c.order.deposit_cents, referenceNumber: `CRM-${c.order.display_id}-DEPOSIT`, accountId: config.accountId, storedPaymentId: c.quote.zoho_payment_id });
    if (payment?.payment_id !== parsed.paymentId) throw new UserFacingError("The previously verified payment is no longer available. Refresh; no new payment was created.");
  }
  if (c.order.current_status === "quotation_sent") return advanceOrderStatus({ orderId: parsed.orderId, expectedStatus: "quotation_sent", reuseExistingPaymentId: parsed.reuseOnly ? parsed.paymentId : undefined, note: "Confirmed deposit after reviewing existing invoice commercial items." });
  if (!["order_recorded", "deposit_received"].includes(c.order.current_status)) throw new UserFacingError("This order cannot change stage through invoice recovery.");
  const receipt = await ensureZohoInvoiceForOrder(parsed.orderId, { recoverExistingInvoice: c.order.current_status === "order_recorded", reuseOnly: parsed.reuseOnly, expectedPaymentId: parsed.paymentId });
  if (c.order.current_status === "order_recorded") await db.transaction().execute(async trx => {
    await sql`select public.recover_order_invoice_deposit(${parsed.orderId}::uuid,${receipt.quotationId}::uuid,${receipt.invoiceId},${receipt.paymentId},${receipt.orderTotalCents},${receipt.depositCents},${receipt.commercialFingerprint},${c.session.user.id}::uuid)`.execute(trx);
    const lead = await resolveLeadForOrderSync(trx, c.order);
    const milestone = leadMilestoneForOrderStatus("deposit_received")!;
    if (lead) {
      await trx.updateTable("leads").set({ funnel_stage: milestone.stage, last_outcome: milestone.outcome, updated_at: new Date() }).where("id", "=", lead.id).execute();
      if (lead.funnel_stage !== milestone.stage) await trx.insertInto("lead_stage_events").values({ lead_id: lead.id, from_stage: lead.funnel_stage, to_stage: milestone.stage, changed_at: new Date(), changed_by: c.session.user.id, source: "system" }).execute();
    }
  });
  revalidatePath(`/orders/${parsed.orderId}`); revalidatePath("/orders");
}
export async function previewInvoiceReconciliationUi(orderId: string) { return toActionResult(() => previewInvoiceReconciliation(orderId), "Invoice review could not be loaded."); }
export async function applyInvoiceReconciliationUi(input: unknown) { return toActionResult(() => applyInvoiceReconciliation(input), "Invoice reconciliation could not be completed. Refresh and review."); }
export async function confirmInvoiceDepositUi(input: unknown) { return toActionResult(() => confirmInvoiceDeposit(input), "Invoice payment verification could not be completed. Refresh and review."); }
