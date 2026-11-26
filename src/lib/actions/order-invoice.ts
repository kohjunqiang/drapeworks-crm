"use server";
import "server-only";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireRole, requireSession } from "@/lib/auth/require-role";
import { toActionResult } from "@/lib/user-facing-error";
import { normalizeCommercialInvoice } from "@/lib/quotations/commercial-invoice";
import { invoicePreview, saveInvoiceDocument, createOrderInvoice, chooseInvoiceSource, linkOrderInvoice, completeOrderInvoiceSync, reconcileOrderInvoice, confirmOrderInvoiceCustomer } from "@/lib/invoices/service";
const base=z.object({orderId:z.string().uuid(),fingerprint:z.string().min(1)});
const item=z.object({itemId:z.string().min(1).max(200).nullable().optional(),name:z.string().trim().min(1).max(200),description:z.string().max(5000),quantity:z.number().positive().max(100000),rateCents:z.number().int().min(-100000000).max(100000000),discountPercent:z.number().min(0).max(100)});
function refresh(id:string){revalidatePath(`/orders/${id}`);revalidatePath("/orders");}
export async function previewOrderInvoice(orderId:string){await requireSession();return invoicePreview(z.string().uuid().parse(orderId));}
export async function saveOrderInvoiceItems(input:unknown){await requireRole(["admin","ops"]);const p=base.extend({totalCents:z.number().int().min(0),lines:z.array(item).min(1).max(100)}).parse(input);const document=normalizeCommercialInvoice({invoice_id:"",total:p.totalCents/100,line_items:p.lines.map(l=>({item_id:l.itemId??undefined,name:l.name,description:l.description,quantity:l.quantity,rate:l.rateCents/100,discount:`${l.discountPercent}%`}))});await saveInvoiceDocument(p.orderId,p.fingerprint,document);refresh(p.orderId);}
export async function createInvoiceFromOrder(input:unknown){await requireRole(["admin","ops"]);const p=base.extend({confirmNoCandidateMatch:z.boolean().optional()}).parse(input);await createOrderInvoice(p.orderId,p.fingerprint,p.confirmNoCandidateMatch);refresh(p.orderId);}
export async function selectInvoiceSource(input:unknown){await requireRole(["admin"]);const p=base.extend({choice:z.enum(["zoho","crm"]),confirm:z.literal(true)}).parse(input);await chooseInvoiceSource(p.orderId,p.fingerprint,p.choice);refresh(p.orderId);}
export async function linkExistingOrderInvoice(input:unknown){await requireRole(["admin","ops"]);const p=base.extend({invoiceId:z.string().min(1).max(200),confirm:z.literal(true)}).parse(input);await linkOrderInvoice(p.orderId,p.fingerprint,p.invoiceId);refresh(p.orderId);}
export async function continueOrderInvoice(input:unknown){await requireRole(["admin","ops"]);const p=base.strict().parse(input);await completeOrderInvoiceSync(p.orderId,p.fingerprint);refresh(p.orderId);}
export async function previewOrderInvoiceUi(orderId:string){return toActionResult(()=>previewOrderInvoice(orderId),"Invoice details could not be checked. Retry.");}
export async function saveOrderInvoiceItemsUi(input:unknown){return toActionResult(()=>saveOrderInvoiceItems(input),"Invoice items could not be saved.");}
export async function createInvoiceFromOrderUi(input:unknown){return toActionResult(()=>createInvoiceFromOrder(input),"Invoice creation needs reconciliation. Retry the read-only check.");}
export async function selectInvoiceSourceUi(input:unknown){return toActionResult(()=>selectInvoiceSource(input),"Invoice changes could not be confirmed.");}
export async function linkExistingOrderInvoiceUi(input:unknown){return toActionResult(()=>linkExistingOrderInvoice(input),"Invoice could not be linked. It may already belong to another order.");}
export async function continueOrderInvoiceUi(input:unknown){return toActionResult(()=>continueOrderInvoice(input),"Invoice sync could not be completed. Retry the invoice check.");}
export async function confirmCurrentInvoiceItems(input:unknown){await requireRole(["admin","ops"]);const p=base.extend({confirm:z.literal(true)}).parse(input);const review=await invoicePreview(p.orderId);if(!review.crm)throw new Error("No CRM invoice items exist");await saveInvoiceDocument(p.orderId,p.fingerprint,review.crm);refresh(p.orderId);}
export async function confirmCurrentInvoiceItemsUi(input:unknown){return toActionResult(()=>confirmCurrentInvoiceItems(input),"Current invoice items could not be confirmed.");}

export async function reconcileOrderInvoiceUi(input:unknown){return toActionResult(async()=>{await requireRole(["admin","ops"]);const p=base.parse(input);await reconcileOrderInvoice(p.orderId,p.fingerprint);refresh(p.orderId);},"Pending invoice could not be reconciled. No new invoice was created.");}
export async function searchInvoiceCustomersUi(input:unknown){return toActionResult(async()=>{await requireRole(["admin","ops"]);const p=z.object({orderId:z.string().uuid(),query:z.string().trim().min(2).max(100)}).parse(input);await invoicePreview(p.orderId);const {listZohoContacts}=await import("@/lib/zoho/books");return (await listZohoContacts(p.query)).map(c=>({id:c.contact_id,name:c.contact_name,phone:c.mobile??c.phone??"",email:c.email??""}));},"Zoho customers could not be searched.");}
export async function confirmInvoiceCustomerUi(input:unknown){return toActionResult(async()=>{await requireRole(["admin","ops"]);const p=base.extend({contactId:z.string().min(1).max(200)}).parse(input);await confirmOrderInvoiceCustomer(p.orderId,p.fingerprint,p.contactId);refresh(p.orderId);},"Customer link could not be confirmed. Refresh the invoice workspace.");}
