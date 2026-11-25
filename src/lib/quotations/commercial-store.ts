import "server-only";
import { sql, type Selectable, type Transaction } from "kysely";
import { db } from "@/lib/db/kysely";
import type { OrderInvoiceCommercial } from "@/lib/db/invoice-commercial-schema";
import type { DB } from "@/lib/db/schema";
import type { CommercialInvoice } from "./commercial-invoice";
import { commercialEqual, commercialFromQuotation, commercialFingerprint, normalizeCommercialInvoice } from "./commercial-invoice";
import type { QuotationLineInput } from "@/lib/validation/quotation";
import type { ZohoInvoice } from "@/lib/zoho/books";
import { quotePayloadHash } from "./hash";
import { UserFacingError } from "@/lib/user-facing-error";
export type CommercialSnapshot = Omit<Selectable<OrderInvoiceCommercial>, "document" | "state"> & { document: CommercialInvoice; state: "synced" | "updating" | "uncertain" };
export async function loadCommercialSnapshot(orderId: string, trx: typeof db | Transaction<DB> = db, lock = false) {
  const result = await sql<CommercialSnapshot>`select * from public.order_invoice_commercial where order_id=${orderId}::uuid ${lock ? sql`for update` : sql``}`.execute(trx);
  return result.rows[0] ?? null;
}
export async function persistCommercialSnapshot(trx: Transaction<DB>, input: { orderId: string; quotationId: string; invoiceId: string; document: CommercialInvoice; actorId: string; remote: ZohoInvoice; action: string; before: CommercialInvoice | null }) {
  const fingerprint = commercialFingerprint(input.document);
  await sql`insert into public.order_invoice_commercial(order_id,quotation_id,invoice_id,document,synced_fingerprint,remote_fingerprint,state,updated_by)
    values(${input.orderId}::uuid,${input.quotationId}::uuid,${input.invoiceId},${JSON.stringify(input.document)}::jsonb,${fingerprint},${quotePayloadHash(input.remote)},'synced',${input.actorId}::uuid)
    on conflict(order_id) do update set quotation_id=excluded.quotation_id,invoice_id=excluded.invoice_id,document=excluded.document,synced_fingerprint=excluded.synced_fingerprint,remote_fingerprint=excluded.remote_fingerprint,state='synced',claim_token=null,revision=order_invoice_commercial.revision+1,updated_by=excluded.updated_by,updated_at=now()`.execute(trx);
  await sql`insert into public.order_invoice_commercial_events(order_id,invoice_id,action,before_document,after_document,actor_id) values(${input.orderId}::uuid,${input.invoiceId},${input.action},${input.before ? JSON.stringify(input.before) : null}::jsonb,${JSON.stringify(input.document)}::jsonb,${input.actorId}::uuid)`.execute(trx);
}
// This is the shared authority for every deposit entry point, including old clients.
export async function verifyCommercialForDeposit(input: { orderId: string; quotationId: string; lines: QuotationLineInput[]; quotationTotalCents: number; orderTotalCents: number; depositCents: number; invoice: ZohoInvoice; actorId: string }) {
  return db.transaction().execute(async trx => {
    const order = await trx.selectFrom("orders").select(["price_quoted_cents", "deposit_cents"]).where("id", "=", input.orderId).forUpdate().executeTakeFirstOrThrow();
    const quote = await trx.selectFrom("order_quotations").select(["id", "superseded_at", "status", "lines", "quoted_total_cents"]).where("id", "=", input.quotationId).forUpdate().executeTakeFirstOrThrow();
    if (quote.superseded_at || ["syncing", "sending"].includes(quote.status) || order.price_quoted_cents !== input.orderTotalCents || order.deposit_cents !== input.depositCents) throw new UserFacingError("The order changed. Review its invoice again.");
    const snapshot = await loadCommercialSnapshot(input.orderId, trx, true);
    if (snapshot && (snapshot.invoice_id !== input.invoice.invoice_id || snapshot.quotation_id !== input.quotationId || snapshot.state !== "synced")) throw new UserFacingError("Review invoice reconciliation before confirming the deposit.");
    let document: CommercialInvoice;
    let remote: CommercialInvoice;
    try { document = snapshot?.document ?? commercialFromQuotation(quote.lines as unknown as QuotationLineInput[], quote.quoted_total_cents); remote = normalizeCommercialInvoice(input.invoice); }
    catch (error) { throw new UserFacingError(`Invoice items cannot be verified: ${error instanceof Error ? error.message : "unsupported details"}. Open invoice reconciliation.`); }
    if (document.totalCents !== order.price_quoted_cents || !commercialEqual(document, remote)) throw new UserFacingError("Invoice items or totals differ from the current CRM commercial details. Open invoice reconciliation and choose the source before confirming the deposit.");
    if (!snapshot || snapshot.synced_fingerprint !== commercialFingerprint(remote) || snapshot.remote_fingerprint !== quotePayloadHash(input.invoice)) await persistCommercialSnapshot(trx, { ...input, invoiceId: input.invoice.invoice_id, document: remote, remote: input.invoice, before: snapshot?.document ?? null, action: "verified_for_deposit" });
    return commercialFingerprint(remote);
  });
}
