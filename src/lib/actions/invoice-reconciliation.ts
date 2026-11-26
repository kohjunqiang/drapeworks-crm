"use server";
import "server-only";
import { requireRole, requireSession } from "@/lib/auth/require-role";
import { toActionResult, UserFacingError } from "@/lib/user-facing-error";
// Retired server-action IDs remain fail-closed for stale browser clients.
export async function previewInvoiceReconciliation(orderId:string):Promise<never>{await requireSession();void orderId;throw new UserFacingError("Reload the order to use the current invoice workspace.");}
export async function applyInvoiceReconciliation(input:unknown):Promise<never>{await requireRole(["admin","ops"]);void input;throw new UserFacingError("Reload the order to use the current invoice workspace.");}
export async function confirmInvoiceDeposit(input:unknown):Promise<never>{await requireRole(["admin","ops"]);void input;throw new UserFacingError("Reload the order to verify its current invoice and deposit.");}
export async function previewInvoiceReconciliationUi(orderId:string){return toActionResult(()=>previewInvoiceReconciliation(orderId),"Reload the invoice workspace.");}
export async function applyInvoiceReconciliationUi(input:unknown){return toActionResult(()=>applyInvoiceReconciliation(input),"Reload the invoice workspace.");}
export async function confirmInvoiceDepositUi(input:unknown){return toActionResult(()=>confirmInvoiceDeposit(input),"Reload the invoice workspace.");}
