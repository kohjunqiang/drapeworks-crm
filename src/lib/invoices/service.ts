import "server-only";
import { resolveLeadForOrderSync } from "@/lib/actions/order-customer";
import { leadMilestoneForOrderStatus } from "@/lib/status-flow";
import { randomUUID } from "node:crypto";
import { sql, type Selectable, type Transaction } from "kysely";
import { db } from "@/lib/db/kysely";
import type { DB } from "@/lib/db/schema";
import type { JsonObject, OrderInvoiceLedger } from "@/lib/db/invoice-ledger-schema";
import { requireSession, requireRole } from "@/lib/auth/require-role";
import { UserFacingError } from "@/lib/user-facing-error";
import { commercialEqual, commercialFingerprint, commercialUpdateLines, commercialWriteIssues, invoiceUpdateIssues, normalizeCommercialInvoice, type CommercialInvoice } from "@/lib/quotations/commercial-invoice";
import { quotePayloadHash } from "@/lib/quotations/hash";
import { verifyExistingDepositPayment } from "@/lib/quotations/deposit-verification";
import { createZohoOrderInvoice, createZohoCustomerPayment, getZohoInvoice, getZohoInvoiceBinding, getZohoDepositPaymentConfig, listZohoCustomerInvoices, listZohoCustomerPayments, getZohoCustomerPayment, updateZohoInvoiceCommercial, getZohoContact, type ZohoInvoice } from "@/lib/zoho/books";

type Ledger = Omit<Selectable<OrderInvoiceLedger>, "document"> & { document: CommercialInvoice | null };
type Connection = typeof db | Transaction<DB>;
export async function loadInvoiceLedger(orderId: string, trx: Connection = db, lock = false) {
  return (await sql<Ledger>`select * from public.order_invoice_ledger where order_id=${orderId}::uuid ${lock ? sql`for update` : sql``}`.execute(trx)).rows[0] ?? null;
}
const editableStages = ["order_recorded", "quotation_sent", "deposit_received"];
const marker = (orderId: string) => `CRM-ORDER-${orderId}`;
const financial = (invoice: ZohoInvoice) => ({ id:invoice.invoice_id, customer:invoice.customer_id,currency:invoice.currency_code,status:invoice.status,total:invoice.total,paid:invoice.payment_made,balance:invoice.balance,credits:invoice.credits_applied,writeOff:invoice.write_off_amount,withheld:invoice.tax_amount_withheld,ach:invoice.ach_payment_initiated });
function unresolvedInvoiceOperation(ledger:Ledger|null) {
  if(!ledger)return false;
  if(["pending","uncertain"].includes(ledger.invoice_state)||(ledger.claim_token&&ledger.claim_kind!=="payment"))return true;
  if(!ledger.legacy_unresolved)return false;
  const operations=(Array.isArray(ledger.legacy_operations)?ledger.legacy_operations:[]).filter((operation):operation is JsonObject=>typeof operation==="object"&&operation!==null&&!Array.isArray(operation));
  const invoiceUnresolved=operations.some(operation=>["pending","uncertain"].includes(String(operation.invoice_state??""))||Boolean(operation.invoice_claim_token));
  const paymentEvidence=operations.some(operation=>Boolean(operation.payment_id)||Boolean(operation.payment_claim_token)||!["","not_started"].includes(String(operation.payment_state??"")));
  const invoiceIds=new Set(operations.map(operation=>typeof operation.invoice_id==="string"&&operation.invoice_id?operation.invoice_id:null).filter((id):id is string=>Boolean(id)));
  return invoiceUnresolved||invoiceIds.size>1||!paymentEvidence;
}
function invoiceLedgerForComparison(ledger:Ledger|null) {
  if(!ledger)return null;
  const {payment_id:paymentId,payment_number:paymentNumber,payment_state:paymentState,claim_token:claimToken,claim_kind:claimKind,legacy_unresolved:legacyUnresolved,legacy_operations:legacyOperations,revision:revision,updated_at:updatedAt,updated_by:updatedBy,verified_fingerprint:verifiedFingerprint,...invoice}=ledger;
  void paymentId;void paymentNumber;void paymentState;void legacyUnresolved;void legacyOperations;void revision;void updatedAt;void updatedBy;void verifiedFingerprint;
  return {...invoice,claim_token:claimKind==="payment"?null:claimToken,claim_kind:claimKind==="payment"?null:claimKind,legacy_unresolved:unresolvedInvoiceOperation(ledger)};
}
function validInvoice(invoice: ZohoInvoice, id: string, customer: string) {
  if(invoice.invoice_id!==id || invoice.customer_id!==customer || invoice.currency_code!=="SGD" || !["draft","sent","overdue","partially_paid","paid"].includes(invoice.status??"")) throw new UserFacingError("The invoice identity, customer, currency or status cannot be verified.");
}
async function local(orderId: string, trx: Connection = db, lock = false) {
  let query=trx.selectFrom("orders").select(["id","display_id","customer_id","consultant_id","current_status","is_draft","price_quoted_cents","deposit_cents","lead_id","appointment_id"]).where("id","=",orderId);
  if(lock) query=query.forUpdate();
  const order=await query.executeTakeFirstOrThrow();
  const ledger=await loadInvoiceLedger(orderId,trx,lock);
  const link=await trx.selectFrom("customer_zoho_links").select("zoho_contact_id").where("customer_id","=",order.customer_id).executeTakeFirst();
  const customerId=ledger?.customer_id??link?.zoho_contact_id??null;
  if(ledger?.customer_id && link?.zoho_contact_id && ledger.customer_id!==link.zoho_contact_id) throw new UserFacingError("The order invoice customer differs from the confirmed CRM customer link. Ask an admin to review it.");
  const source=(await sql<{context:{order:{product:string;package:string|null};rooms:Array<{label:string}>;windows:Array<{width_cm:number|null;height_cm:number|null}>;mesh:unknown[]}}>`select jsonb_build_object(
    'order',jsonb_build_object('product',o.product_line,'package',o.curtain_package_id,'packageRules',o.curtain_package_rules,'packagePrice',o.curtain_package_sale_sgd_cents,'discount',o.discount_bps,'installation',o.extra_install_sgd_cents,'freight',o.freight_mode,'channel',o.channel),
    'rooms',(select coalesce(jsonb_agg(to_jsonb(r)-'created_at' order by r.id),'[]') from public.rooms r where r.order_id=o.id),
    'windows',(select coalesce(jsonb_agg(to_jsonb(w)-'created_at'-'updated_at' order by w.id),'[]') from public.windows w join public.rooms r on r.id=w.room_id where r.order_id=o.id),
    'mesh',(select coalesce(jsonb_agg(to_jsonb(m)-'created_at' order by m.id),'[]') from public.mesh_panels m join public.rooms r on r.id=m.room_id where r.order_id=o.id),
    'addons',(select coalesce(jsonb_agg(to_jsonb(a)-'created_at' order by a.window_id,a.addon_id),'[]') from public.window_addons a join public.windows w on w.id=a.window_id join public.rooms r on r.id=w.room_id where r.order_id=o.id)
  ) as context from public.orders o where o.id=${orderId}::uuid`.execute(trx)).rows[0].context;
  return {order,ledger,customerId,sourceFingerprint:quotePayloadHash(source),sourceContext:[`Product: ${source.order.product}`, ...(source.order.package?[`Package: ${source.order.package}`]:[]),`Rooms: ${source.rooms.map(room=>room.label).join(", ")||"None recorded"}`,`${source.windows.length} windows · ${source.mesh.length} mesh panels`,...source.windows.map((window,index)=>`Window ${index+1}: ${window.width_cm??"?"} × ${window.height_cm??"?"} cm`)]};
}
const localHash = (c: Awaited<ReturnType<typeof local>>) => quotePayloadHash({order:c.order,customer:c.customerId,ledger:c.ledger,source:c.sourceFingerprint});
const invoiceLocalHash = (c: Awaited<ReturnType<typeof local>>) => quotePayloadHash({order:c.order,customer:c.customerId,ledger:invoiceLedgerForComparison(c.ledger),source:c.sourceFingerprint});
export async function invoiceContext(orderId:string) {
  const session=await requireSession();
  const c=await local(orderId);
  const operator=["admin","ops"].includes(session.profile.role);
  if(!operator && !(session.profile.role==="consultant"&&session.user.id===c.order.consultant_id)) throw new UserFacingError("Forbidden");
  const binding=await getZohoInvoiceBinding();
  if(c.ledger?.organization_id && c.ledger.organization_id!==binding.organizationId) throw new UserFacingError("The invoice belongs to a different Zoho organization.");
  let invoice:ZohoInvoice|null=null;
  let candidates:ZohoInvoice[]=[];
  if(c.customerId) {
    if(c.ledger?.invoice_id) { invoice=await getZohoInvoice(c.ledger.invoice_id);validInvoice(invoice,c.ledger.invoice_id,c.customerId); }
    else {
      const ownedByOthers=(await sql<{invoice_id:string}>`select invoice_id from public.order_invoice_ledger where organization_id=${binding.organizationId} and order_id<>${orderId}::uuid and invoice_id is not null`.execute(db)).rows.map(row=>row.invoice_id);
      candidates=(await listZohoCustomerInvoices(c.customerId)).filter(invoice=>!ownedByOthers.includes(invoice.invoice_id));
      // Only our durable pending creation permits recovery by immutable order UUID.
      const owned=c.ledger && ["pending","uncertain"].includes(c.ledger.invoice_state) && !c.ledger.legacy_unresolved ? candidates.filter(i=>i.reference_number===marker(orderId)) : [];
      if(owned.length>1) throw new UserFacingError("Multiple invoices carry this order identifier. Reconcile them before continuing.");
      if(owned.length===1) { invoice=owned[0];validInvoice(invoice,invoice.invoice_id,c.customerId); }
    }
  }
  let zoho:CommercialInvoice|null=null;let issue:string|null=null;
  if(invoice) try { zoho=normalizeCommercialInvoice(invoice); } catch(error) { issue=error instanceof Error?error.message:"Invoice items could not be verified"; }
  const crm=c.ledger?.document??null;
  const sourceCurrent=c.ledger?.source_fingerprint===c.sourceFingerprint;
  const equal=Boolean(sourceCurrent&&crm&&zoho&&crm.totalCents===c.order.price_quoted_cents&&commercialEqual(crm,zoho));
  const compared=invoice?{id:invoice.invoice_id,customer:invoice.customer_id,currency:invoice.currency_code,number:invoice.invoice_number??null,commercial:zoho?commercialFingerprint(zoho):issue}:null;
  const candidatesFingerprint=candidates.map(i=>({id:i.invoice_id,customer:i.customer_id,status:i.status})).sort((a,b)=>a.id.localeCompare(b.id));
  const fingerprint=quotePayloadHash({local:invoiceLocalHash(c),invoice:compared,candidates:candidatesFingerprint});
  const mutationFingerprint=quotePayloadHash({local:localHash(c),invoice:invoice?financial(invoice):null,commercial:zoho?commercialFingerprint(zoho):issue,candidates:candidatesFingerprint});
  return {...c,session,operator,admin:session.profile.role==="admin",organizationId:binding.organizationId,invoice,candidates,crm,zoho,equal,sourceCurrent,issue,fingerprint,mutationFingerprint,localFingerprint:localHash(c),invoiceLocalFingerprint:invoiceLocalHash(c)};
}
type Context=Awaited<ReturnType<typeof invoiceContext>>;
async function assertCurrent(c:Context,trx:Connection=db) {
  const now=await local(c.order.id,trx,trx!==db);
  if(localHash(now)!==c.localFingerprint) throw new UserFacingError("The CRM order changed. Refresh its invoice details.");
  return now;
}
async function assertInvoiceCurrent(c:Context,trx:Connection=db) {
  const now=await local(c.order.id,trx,trx!==db);
  if(invoiceLocalHash(now)!==c.invoiceLocalFingerprint) throw new UserFacingError("The CRM order changed. Refresh its invoice details.");
  return now;
}
function editable(c:Context) { if(c.order.is_draft||!editableStages.includes(c.order.current_status)) throw new UserFacingError("Invoice details are read-only at this order stage."); }
async function audit(trx:Transaction<DB>,c:Context,action:string,document:CommercialInvoice|null) {
  await sql`insert into public.order_invoice_audit(order_id,action,before_document,after_document,actor_id) values(${c.order.id}::uuid,${action},${c.crm?JSON.stringify(c.crm):null}::jsonb,${document?JSON.stringify(document):null}::jsonb,${c.session.user.id}::uuid)`.execute(trx);
}
async function ensureLedger(trx:Transaction<DB>,c:Context) {
  await sql`insert into public.order_invoice_ledger(order_id,organization_id,customer_id,updated_by) values(${c.order.id}::uuid,${c.organizationId},${c.customerId},${c.session.user.id}::uuid) on conflict(order_id) do nothing`.execute(trx);
  await sql`update public.order_invoice_ledger set organization_id=${c.organizationId},customer_id=${c.customerId} where order_id=${c.order.id}::uuid`.execute(trx);
}
async function setLink(trx:Transaction<DB>,c:Context,invoice:ZohoInvoice) {
  const owned=(await sql<{order_id:string}>`select order_id from public.order_invoice_ledger where invoice_id=${invoice.invoice_id} and order_id<>${c.order.id}::uuid and (organization_id=${c.organizationId} or organization_id is null) for update`.execute(trx)).rows;
  if(owned.length)throw new UserFacingError("This invoice is already linked to another CRM order.");
  await ensureLedger(trx,c);
  await sql`update public.order_invoice_ledger set invoice_id=${invoice.invoice_id},invoice_number=${invoice.invoice_number??null},invoice_state='linked',revision=revision+1,updated_at=now(),updated_by=${c.session.user.id}::uuid where order_id=${c.order.id}::uuid`.execute(trx);
}
async function claim(c:Context,kind:"invoice"|"payment"|"update") {
  const token=randomUUID();
  await db.transaction().execute(async trx=>{
    await assertCurrent(c,trx);await ensureLedger(trx,c);
    if(c.ledger?.claim_token || (kind==="invoice"&&c.ledger?.invoice_state!==undefined&&c.ledger.invoice_state!=="idle") || (kind==="payment"&&c.ledger?.payment_state!==undefined&&c.ledger.payment_state!=="idle")) throw new UserFacingError("An earlier operation must be reconciled first. No new financial record was created.");
    await sql`update public.order_invoice_ledger set claim_token=${token}::uuid,claim_kind=${kind==='invoice'?'create':kind},${kind==="payment"?sql`payment_state='pending'`:sql`invoice_state='pending'`},revision=revision+1,updated_at=now() where order_id=${c.order.id}::uuid`.execute(trx);
  });
  return token;
}
async function verifyClaim(c:Context,token:string,trx:Connection=db) {
  const now=await local(c.order.id,trx,trx!==db);
  if(now.ledger?.claim_token!==token || quotePayloadHash(now.order)!==quotePayloadHash(c.order) || now.sourceFingerprint!==c.sourceFingerprint || now.customerId!==c.customerId || (now.ledger.document?commercialFingerprint(now.ledger.document):null)!==(c.crm?commercialFingerprint(c.crm):null)) throw new UserFacingError("The order changed while checking Zoho. No further financial write is allowed.");
  return now;
}
async function uncertain(c:Context,token:string,kind:"invoice"|"payment") {
  await sql`update public.order_invoice_ledger set ${kind==="payment"?sql`payment_state='uncertain'`:sql`invoice_state='uncertain'`},updated_at=now() where order_id=${c.order.id}::uuid and claim_token=${token}::uuid`.execute(db);
}
async function releaseUnsentClaim(c:Context,token:string,kind:"invoice"|"payment") {
  await sql`update public.order_invoice_ledger set claim_token=null,claim_kind=null,${kind==="payment"?sql`payment_state=${c.ledger?.payment_state??"idle"}`:sql`invoice_state=${c.ledger?.invoice_state??"idle"}`},revision=revision+1,updated_at=now() where order_id=${c.order.id}::uuid and claim_token=${token}::uuid`.execute(db);
}
const paymentInput=(c:Context)=>({customerId:c.customerId!,invoiceId:c.invoice!.invoice_id,invoiceNumber:c.invoice!.invoice_number??null,amountCents:c.order.deposit_cents,referenceNumber:`CRM-${c.order.display_id}-DEPOSIT`,accountId:getZohoDepositPaymentConfig().accountId,storedPaymentId:c.ledger?.payment_id});
function itemEditorIssue(document:CommercialInvoice|null) {
  return document&&(commercialWriteIssues(document).length||document.lines.some(line=>!line.discountInput.endsWith("%")&&Number(line.discountInput)!==0))?"This invoice includes tax, shipping, adjustments or flat discounts. These amounts are preserved; use the reviewed Zoho source rather than the simple item editor.":null;
}
export async function invoicePreview(orderId:string) {
  const c=await invoiceContext(orderId);
  const latest=(await sql<{action:string;after_document:CommercialInvoice|null}>`select action,after_document from public.order_invoice_audit where order_id=${orderId}::uuid and action<>'deposit_verified' order by created_at desc,id desc limit 1`.execute(db)).rows[0]??null;
  const currentFingerprint=c.crm?commercialFingerprint(c.crm):null;
  let auditFingerprint:string|null=null;
  try {auditFingerprint=latest?.after_document?commercialFingerprint(latest.after_document):null;} catch {auditFingerprint=null;}
  const syncComplete=Boolean(c.equal&&currentFingerprint&&c.invoice&&c.ledger?.invoice_id===c.invoice.invoice_id&&c.ledger.invoice_state==="linked"&&!unresolvedInvoiceOperation(c.ledger)&&c.ledger.source_fingerprint===c.sourceFingerprint&&c.ledger.verified_fingerprint===currentFingerprint&&latest?.action==="invoice_sync_verified"&&auditFingerprint===currentFingerprint);
  // One explicit next action once the invoice matches: confirm the recorded CRM
  // deposit and open manufacturing. Already-verified orders stay eligible — the
  // handoff is the stage transition, not another verification.
  const canContinueToManufacturing=Boolean(c.equal&&c.operator&&!c.order.is_draft&&["order_recorded","quotation_sent"].includes(c.order.current_status)&&c.invoice&&c.ledger?.invoice_id===c.invoice.invoice_id&&c.ledger.invoice_state==="linked"&&!unresolvedInvoiceOperation(c.ledger)&&c.order.deposit_cents>0&&c.order.deposit_cents<=c.order.price_quoted_cents);
  return {orderId,fingerprint:c.fingerprint,mutationFingerprint:c.mutationFingerprint,stage:c.order.current_status,totalCents:c.order.price_quoted_cents,depositCents:c.order.deposit_cents,canContinueToManufacturing,itemEditorIssue:itemEditorIssue(c.crm),sourceContext:c.sourceContext,customerLinked:Boolean(c.customerId),sourceCurrent:c.sourceCurrent,crm:c.crm,zoho:c.zoho,equal:c.equal,syncComplete,invoiceId:c.invoice?.invoice_id??null,invoiceNumber:c.invoice?.invoice_number??null,invoiceStatus:c.invoice?.status??null,issue:c.issue,operator:c.operator,admin:c.admin,editable:editableStages.includes(c.order.current_status)&&!c.order.is_draft,canCreate:Boolean(c.customerId&&c.crm&&c.sourceCurrent&&!c.invoice&&!unresolvedInvoiceOperation(c.ledger)),canReconcile:Boolean(c.invoice&&c.ledger?.claim_token&&["create","update"].includes(c.ledger.claim_kind??"")),uncertain:unresolvedInvoiceOperation(c.ledger),candidates:c.invoice?[]:c.candidates.map(i=>({id:i.invoice_id,number:i.invoice_number??i.invoice_id,total:i.total??null,status:i.status??"unknown"})),updateIssues:c.invoice?[...invoiceUpdateIssues(c.invoice),...commercialWriteIssues(c.crm),...commercialWriteIssues(c.zoho)]:[]};
}
export async function saveInvoiceDocument(orderId:string,fingerprint:string,document:CommercialInvoice) {
  await requireRole(["admin","ops"]);const c=await invoiceContext(orderId);editable(c);
  if(c.fingerprint!==fingerprint) throw new UserFacingError("The invoice review changed. Refresh first.");
  if(document.totalCents!==c.order.price_quoted_cents) throw new UserFacingError("Invoice item amounts must sum to the agreed CRM order total.");
  if(c.ledger?.claim_token) throw new UserFacingError("Reconcile the pending operation before changing CRM items.");
  if(c.crm&&itemEditorIssue(c.crm)&&!commercialEqual(c.crm,document))throw new UserFacingError(itemEditorIssue(c.crm)!);
  await db.transaction().execute(async trx=>{await assertCurrent(c,trx);await ensureLedger(trx,c);await sql`update public.order_invoice_ledger set document=${JSON.stringify(document)}::jsonb,source_fingerprint=${c.sourceFingerprint},verified_fingerprint=null,revision=revision+1,updated_at=now(),updated_by=${c.session.user.id}::uuid where order_id=${orderId}::uuid`.execute(trx);await audit(trx,c,"crm_items_saved",document);});
}
export async function linkOrderInvoice(orderId:string,fingerprint:string,invoiceId:string) {
  await requireRole(["admin","ops"]);const c=await invoiceContext(orderId);editable(c);
  if(c.fingerprint!==fingerprint||c.ledger?.invoice_id) throw new UserFacingError("The invoice links changed. Refresh first.");
  const invoice=await getZohoInvoice(invoiceId);if(!c.customerId) throw new UserFacingError("Confirm the CRM customer's Zoho link first.");validInvoice(invoice,invoiceId,c.customerId);
  if(!c.candidates.some(i=>i.invoice_id===invoiceId)) throw new UserFacingError("Select a verified invoice for this customer.");
  await db.transaction().execute(async trx=>{await assertCurrent(c,trx);await setLink(trx,c,invoice);await audit(trx,c,"existing_invoice_linked",c.crm);});
}
export async function completeOrderInvoiceSync(orderId:string,fingerprint:string) {
  await requireRole(["admin","ops"]);const c=await invoiceContext(orderId);editable(c);
  if(c.fingerprint!==fingerprint) throw new UserFacingError("The invoice review changed. Refresh first.");
  if(!c.customerId||!c.invoice||!c.zoho||!c.crm||!c.sourceCurrent||!c.equal||c.crm.totalCents!==c.order.price_quoted_cents) throw new UserFacingError("Resolve the current invoice comparison before continuing.");
  if(!c.ledger?.invoice_id||c.ledger.invoice_id!==c.invoice.invoice_id||c.ledger.invoice_state!=="linked"||unresolvedInvoiceOperation(c.ledger)) throw new UserFacingError("Reconcile the linked invoice operation before continuing.");
  await db.transaction().execute(async trx=>{
    const now=await assertInvoiceCurrent(c,trx);
    if(!now.ledger?.invoice_id||now.ledger.invoice_id!==c.invoice!.invoice_id||now.ledger.invoice_state!=="linked"||unresolvedInvoiceOperation(now.ledger)||!now.ledger.document||commercialFingerprint(now.ledger.document)!==commercialFingerprint(c.crm!)||now.ledger.source_fingerprint!==now.sourceFingerprint) throw new UserFacingError("The linked invoice changed while it was being verified. Refresh first.");
    await setLink(trx,c,c.invoice!);
    await sql`update public.order_invoice_ledger set verified_fingerprint=${commercialFingerprint(c.crm!)},source_fingerprint=${now.sourceFingerprint},updated_at=now(),updated_by=${c.session.user.id}::uuid where order_id=${orderId}::uuid`.execute(trx);
    await audit(trx,c,"invoice_sync_verified",c.crm);
  });
}
export async function createOrderInvoice(orderId:string,fingerprint:string,confirmNoCandidateMatch=false) {
  await requireRole(["admin","ops"]);const c=await invoiceContext(orderId);editable(c);
  if(c.fingerprint!==fingerprint||!c.customerId||!c.crm||!c.sourceCurrent||c.crm.totalCents!==c.order.price_quoted_cents) throw new UserFacingError("Save and review current CRM invoice items first.");
  if(c.invoice) return; // already observed, never create a second document
  if((c.candidates.length&&!confirmNoCandidateMatch)||c.ledger?.legacy_unresolved) throw new UserFacingError("Link the existing customer invoice explicitly before continuing.");
  const lines=commercialUpdateLines(c.crm);const token=await claim(c,"invoice");
  let remote:ZohoInvoice;let attempted=false;
  try {
    const otherIds=(await sql<{invoice_id:string}>`select invoice_id from public.order_invoice_ledger where organization_id=${c.organizationId} and order_id<>${orderId}::uuid and invoice_id is not null`.execute(db)).rows.map(row=>row.invoice_id);
    const candidates=(await listZohoCustomerInvoices(c.customerId)).filter(invoice=>!otherIds.includes(invoice.invoice_id));
    if(quotePayloadHash(candidates.map(i=>i.invoice_id).sort())!==quotePayloadHash(c.candidates.map(i=>i.invoice_id).sort())) throw new UserFacingError("A customer invoice appeared during creation checks. Reconcile it; no new invoice was sent.");
    await verifyClaim(c,token);
    attempted=true;remote=await createZohoOrderInvoice({customerId:c.customerId,orderId,lines,date:new Date().toISOString().slice(0,10)});
  } catch(error) { if(!attempted){await releaseUnsentClaim(c,token,"invoice");throw error instanceof UserFacingError?error:new UserFacingError("Existing invoices could not be checked. No invoice was sent. Retry the check.");} await uncertain(c,token,"invoice");throw new UserFacingError("Invoice creation is unconfirmed. Retry the read-only check; a second invoice will not be created."); }
  const verified=await getZohoInvoice(remote.invoice_id);validInvoice(verified,remote.invoice_id,c.customerId);
  if(verified.reference_number!==marker(orderId)||!commercialEqual(c.crm,normalizeCommercialInvoice(verified))) {await uncertain(c,token,"invoice");throw new UserFacingError("The created invoice needs reconciliation. No second invoice will be created.");}
  await db.transaction().execute(async trx=>{await verifyClaim(c,token,trx);await setLink(trx,c,verified);await sql`update public.order_invoice_ledger set claim_token=null,claim_kind=null,verified_fingerprint=${commercialFingerprint(c.crm!)} where order_id=${orderId}::uuid`.execute(trx);await audit(trx,c,"invoice_created",c.crm);});
}
async function noAllocations(invoice:ZohoInvoice,customer:string) {
  for(const summary of await listZohoCustomerPayments(customer)) {
    const payment=await getZohoCustomerPayment(summary.payment_id);
    if(payment.payment_id!==summary.payment_id||payment.customer_id!==customer||!Array.isArray(payment.invoices)) throw new UserFacingError("Payment allocations could not be verified.");
    if(payment.invoices.some(i=>i.invoice_id===invoice.invoice_id)) throw new UserFacingError("This invoice has existing payment allocations and cannot be updated.");
  }
}
export async function chooseInvoiceSource(orderId:string,fingerprint:string,choice:"zoho"|"crm") {
  await requireRole(["admin"]);const c=await invoiceContext(orderId);editable(c);
  if((choice==="zoho"?c.fingerprint:c.mutationFingerprint)!==fingerprint||!c.invoice||!c.zoho) throw new UserFacingError("Refresh the current invoice comparison first.");
  const target=choice==="zoho"?c.zoho:c.crm;
  if(!target||target.totalCents<c.order.deposit_cents) throw new UserFacingError("Invoice total cannot be below the recorded deposit.");
  if(choice==="zoho") {
    // CRM-only adoption preserves unresolved payment claims and every Zoho record.
    if(unresolvedInvoiceOperation(c.ledger)) throw new UserFacingError("Reconcile the pending invoice operation before adopting items.");
    await db.transaction().execute(async trx=>{
      await assertCurrent(c,trx);await setLink(trx,c,c.invoice!);
      if(target.totalCents!==c.order.price_quoted_cents) await sql`select public.amend_order_payment(${orderId}::uuid,${target.totalCents}::integer,${c.order.deposit_cents}::integer,${c.session.user.id}::uuid)`.execute(trx);
      await sql`update public.order_invoice_ledger set document=${JSON.stringify(target)}::jsonb,source_fingerprint=${c.sourceFingerprint},verified_fingerprint=${commercialFingerprint(target)},revision=revision+1,updated_at=now() where order_id=${orderId}::uuid`.execute(trx);
      await audit(trx,c,"zoho_items_adopted",target);
    });return;
  }
  if(!c.sourceCurrent || target.totalCents!==c.order.price_quoted_cents) throw new UserFacingError("Review and save the CRM items against current order details first.");
  const issues=[...invoiceUpdateIssues(c.invoice),...commercialWriteIssues(c.crm),...commercialWriteIssues(c.zoho)];
  if(issues.length||c.ledger?.legacy_unresolved||["pending","uncertain"].includes(c.ledger?.payment_state??"")) throw new UserFacingError(issues[0]??"Reconcile the unresolved financial operation first.");
  const lines=commercialUpdateLines(target);const token=await claim(c,"update");let attempted=false;
  try {
    await noAllocations(c.invoice,c.customerId!);
    const fresh=await getZohoInvoice(c.invoice.invoice_id);validInvoice(fresh,c.invoice.invoice_id,c.customerId!);
    if(invoiceUpdateIssues(fresh).length||!commercialEqual(c.zoho,normalizeCommercialInvoice(fresh))) throw new UserFacingError("Zoho invoice changed. No update was sent.");
    await verifyClaim(c,token);
    try {attempted=true;await updateZohoInvoiceCommercial(fresh.invoice_id,lines,c.customerId!);} catch { /* reconcile acknowledgement loss through GET, never resend */ }
    const after=await getZohoInvoice(fresh.invoice_id);validInvoice(after,fresh.invoice_id,c.customerId!);
    if(invoiceUpdateIssues(after).length||after.invoice_number!==fresh.invoice_number||!commercialEqual(target,normalizeCommercialInvoice(after))) throw new UserFacingError("Invoice update remains unconfirmed. Retry the check without resending.");
    await db.transaction().execute(async trx=>{await verifyClaim(c,token,trx);await setLink(trx,c,after);await sql`update public.order_invoice_ledger set claim_token=null,claim_kind=null,verified_fingerprint=${commercialFingerprint(target)} where order_id=${orderId}::uuid`.execute(trx);await audit(trx,c,"crm_items_sent",target);});
  } catch(error) {if(attempted)await uncertain(c,token,"invoice");else await releaseUnsentClaim(c,token,"invoice");throw error;}
}
export async function confirmOrderInvoiceDeposit(input:{orderId:string;fingerprint:string;paymentId?:string;confirmReceipt?:boolean}) {
  await requireRole(["admin","ops"]);const c=await invoiceContext(input.orderId);editable(c);
  if(c.mutationFingerprint!==input.fingerprint||!c.invoice||!c.customerId||!c.equal||!c.crm||c.order.deposit_cents<=0) throw new UserFacingError("Refresh and resolve current invoice details before confirming the deposit.");
  let payment=await verifyExistingDepositPayment(paymentInput(c));
  let token:string|null=null;
  if(input.paymentId && payment?.payment_id!==input.paymentId) throw new UserFacingError("The previously verified deposit is no longer available. No new payment was created.");
  if(!payment) {
    if(!input.confirmReceipt||input.paymentId) throw new UserFacingError("Explicit receipt confirmation is required before recording a payment.");
    if(c.ledger?.legacy_unresolved||["pending","uncertain"].includes(c.ledger?.invoice_state??"")||["pending","uncertain"].includes(c.ledger?.payment_state??"")) throw new UserFacingError("An uncertain financial operation must be reconciled. No new payment will be created.");
    token=await claim(c,"payment");let attempted=false;
    try {
      payment=await verifyExistingDepositPayment(paymentInput(c));
      if(!payment) {
        const fresh=await getZohoInvoice(c.invoice.invoice_id);validInvoice(fresh,c.invoice.invoice_id,c.customerId);
        if(invoiceUpdateIssues(fresh).length||!commercialEqual(c.crm,normalizeCommercialInvoice(fresh))) throw new UserFacingError("Invoice items or payment activity changed. No new payment was sent.");
        await verifyClaim(c,token);
        attempted=true;const created=await createZohoCustomerPayment({customerId:c.customerId,invoiceId:c.invoice.invoice_id,amountCents:c.order.deposit_cents,date:new Date().toISOString().slice(0,10),referenceNumber:paymentInput(c).referenceNumber,...getZohoDepositPaymentConfig()});
        payment=await verifyExistingDepositPayment({...paymentInput(c),storedPaymentId:created.payment_id});
      }
      if(!payment) throw new UserFacingError("Payment acknowledgement could not be verified.");
    } catch(error) {if(!attempted){await releaseUnsentClaim(c,token,"payment");throw error instanceof UserFacingError?error:new UserFacingError("Deposit verification failed before recording. No payment was sent. Retry the check.");}await uncertain(c,token,"payment");throw new UserFacingError("Deposit recording is unconfirmed. Retry verification; no duplicate payment will be created.");}
  }
  const final=await getZohoInvoice(c.invoice.invoice_id);validInvoice(final,c.invoice.invoice_id,c.customerId);
  if(!commercialEqual(c.crm,normalizeCommercialInvoice(final))) throw new UserFacingError("Invoice items changed after payment verification. Refresh the comparison.");
  const verifiedPayment=await verifyExistingDepositPayment({...paymentInput(c),storedPaymentId:payment.payment_id});
  if(verifiedPayment?.payment_id!==payment.payment_id) throw new UserFacingError("Deposit payment changed during final verification.");
  await db.transaction().execute(async trx=>{
    if(token) await verifyClaim(c,token,trx);else await assertCurrent(c,trx);
    await setLink(trx,c,final);
    const fingerprint=commercialFingerprint(c.crm!);
    await sql`update public.order_invoice_ledger set payment_id=${payment!.payment_id},payment_number=${verifiedPayment.payment_number},payment_state='linked',claim_token=null,claim_kind=null,verified_fingerprint=${fingerprint},updated_at=now() where order_id=${input.orderId}::uuid`.execute(trx);
    await sql`select public.confirm_order_invoice_deposit(${input.orderId}::uuid,${final.invoice_id},${payment!.payment_id},${c.order.price_quoted_cents},${c.order.deposit_cents},${fingerprint},${c.session.user.id}::uuid)`.execute(trx);
    const lead=await resolveLeadForOrderSync(trx,c.order);const milestone=leadMilestoneForOrderStatus("deposit_received")!;
    if(lead){await trx.updateTable("leads").set({funnel_stage:milestone.stage,last_outcome:milestone.outcome,updated_at:new Date()}).where("id","=",lead.id).execute();if(lead.funnel_stage!==milestone.stage)await trx.insertInto("lead_stage_events").values({lead_id:lead.id,from_stage:lead.funnel_stage,to_stage:milestone.stage,changed_at:new Date(),changed_by:c.session.user.id,source:"system"}).execute();}
    await audit(trx,c,"deposit_verified",c.crm);
  });
}
// The invoice-verified deposit handoff reuses this verified comparison, narrowed
// to what a status advance may rely on. The remote invoice is read here, before
// the caller's status transaction; assertInvoiceDepositReview re-checks the same
// snapshot under the order row lock inside that transaction. Payment APIs are
// deliberately untouched — this path confirms the recorded CRM deposit, not a
// Zoho payment.
export async function prepareInvoiceDepositReview(orderId:string,fingerprint:string) {
  const c=await invoiceContext(orderId);
  if(c.fingerprint!==fingerprint) throw new UserFacingError("The invoice review changed. Refresh first.");
  if(!c.operator) throw new UserFacingError("Forbidden");
  if(c.order.is_draft||!["order_recorded","quotation_sent"].includes(c.order.current_status)) throw new UserFacingError("The recorded-deposit handoff is only available before the deposit stage.");
  if(!c.customerId||!c.invoice||!c.zoho||!c.crm||!c.sourceCurrent||!c.equal||c.crm.totalCents!==c.order.price_quoted_cents) throw new UserFacingError("Resolve the current invoice comparison before confirming the deposit.");
  if(!c.ledger?.invoice_id||c.ledger.invoice_id!==c.invoice.invoice_id||c.ledger.invoice_state!=="linked"||unresolvedInvoiceOperation(c.ledger)) throw new UserFacingError("Reconcile the pending invoice operation before continuing.");
  if(c.order.deposit_cents<=0||c.order.deposit_cents>c.order.price_quoted_cents) throw new UserFacingError("A positive recorded deposit no greater than the order total is required before continuing to manufacturing.");
  return c;
}
export async function assertInvoiceDepositReview(c:Context,trx:Transaction<DB>) {
  const now=await assertInvoiceCurrent(c,trx);
  if(!now.ledger?.invoice_id||now.ledger.invoice_id!==c.invoice!.invoice_id||now.ledger.invoice_state!=="linked"||unresolvedInvoiceOperation(now.ledger)||!now.ledger.document||commercialFingerprint(now.ledger.document)!==commercialFingerprint(c.crm!)||now.ledger.source_fingerprint!==now.sourceFingerprint) throw new UserFacingError("The linked invoice changed while it was being verified. Refresh first.");
  return now;
}
export async function usesInvoiceWorkspace(orderId:string) {
  const c=await local(orderId);
  if(c.order.current_status!=="order_recorded"||c.ledger?.invoice_id||c.ledger?.legacy_unresolved||["pending","uncertain"].includes(c.ledger?.invoice_state??"")) return true;
  if(!c.customerId) return false;
  try {
    const binding=await getZohoInvoiceBinding();
    const owned=(await sql<{invoice_id:string}>`select invoice_id from public.order_invoice_ledger where organization_id=${binding.organizationId} and order_id<>${orderId}::uuid and invoice_id is not null`.execute(db)).rows.map(row=>row.invoice_id);
    return (await listZohoCustomerInvoices(c.customerId)).some(invoice=>!owned.includes(invoice.invoice_id));
  } catch {return true;}
}

export async function reconcileOrderInvoice(orderId:string,fingerprint:string) {
  await requireRole(["admin","ops"]);const c=await invoiceContext(orderId);editable(c);
  if(c.fingerprint!==fingerprint||!c.invoice||!c.crm||!c.zoho||!c.ledger?.claim_token||!["create","update"].includes(c.ledger.claim_kind??"")) throw new UserFacingError("Refresh the pending invoice check first.");
  if(c.ledger.invoice_state==="pending" && Date.now()-new Date(c.ledger.updated_at).getTime()<120000) throw new UserFacingError("The invoice operation is still in progress. Wait before reconciling it.");
  if(!commercialEqual(c.crm,c.zoho)||(c.ledger.claim_kind==="create"&&c.invoice.reference_number!==marker(orderId))||(c.ledger.claim_kind==="update"&&invoiceUpdateIssues(c.invoice).length)) throw new UserFacingError("The pending invoice does not match its saved request. No operation was repeated; review the existing document in Zoho.");
  await db.transaction().execute(async trx=>{await assertCurrent(c,trx);await setLink(trx,c,c.invoice!);await sql`update public.order_invoice_ledger set claim_token=null,claim_kind=null,verified_fingerprint=${commercialFingerprint(c.crm!)} where order_id=${orderId}::uuid`.execute(trx);await audit(trx,c,"invoice_reconciled",c.crm);});
}

export async function confirmOrderInvoiceCustomer(orderId:string,fingerprint:string,contactId:string) {
  await requireRole(["admin","ops"]);const c=await invoiceContext(orderId);editable(c);
  if(c.fingerprint!==fingerprint||c.customerId||c.ledger?.claim_token||c.ledger?.legacy_unresolved||["pending","uncertain"].includes(c.ledger?.invoice_state??"")||["pending","uncertain"].includes(c.ledger?.payment_state??""))throw new UserFacingError("Customer link or financial state changed. Refresh before linking a customer.");
  const contact=await getZohoContact(contactId);
  if(contact.contact_id!==contactId||contact.status==="inactive"||contact.contact_type==="vendor")throw new UserFacingError("Select an active Zoho customer.");
  await db.transaction().execute(async trx=>{await assertCurrent(c,trx);await trx.insertInto("customer_zoho_links").values({customer_id:c.order.customer_id,zoho_contact_id:contact.contact_id,confirmed_by:c.session.user.id}).execute();});
}
