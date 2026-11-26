"use client";
import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { previewInvoiceReconciliationUi, applyInvoiceReconciliationUi, confirmInvoiceDepositUi } from "@/lib/actions/invoice-reconciliation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import type { CommercialInvoice } from "@/lib/quotations/commercial-invoice";
type Review = Extract<Awaited<ReturnType<typeof previewInvoiceReconciliationUi>>, { ok: true }>["data"];
const money = (cents: number | null) => cents === null ? "Unknown" : new Intl.NumberFormat("en-SG", { style: "currency", currency: "SGD" }).format(cents / 100);
function CommercialDetails({ document, title }: { document: CommercialInvoice | null; title: string }) {
  return <section className="min-w-0 rounded-lg border p-3"><h3 className="font-semibold">{title}</h3>{document ? <><ul className="mt-2 space-y-3 text-sm">{document.lines.map((line, index) => <li key={index} className="border-b pb-2"><p className="font-medium">{line.name}</p><p className="whitespace-pre-wrap text-slate-600">{line.description}</p><p>{line.quantity} × {money(line.rateCents)} · Discount {money(line.discountCents)}</p><p>Item total {money(line.totalCents)}{line.taxId ? ` · Tax ${line.taxId} (${line.taxPercent ?? "unknown"}%)` : ""}</p></li>)}</ul><dl className="mt-3 space-y-1 text-sm">{[["Document discount", document.documentDiscountCents], ["Tax", document.taxCents], ["Shipping", document.shippingCents], ["Adjustment", document.adjustmentCents], ["Total", document.totalCents]].map(([label, value]) => <div key={label} className="flex justify-between gap-3"><dt>{label}</dt><dd className="font-semibold">{money(Number(value))}</dd></div>)}</dl>{document.taxes.length > 0 && <p className="mt-2 text-xs">{document.taxes.map(t => `${t.name} ${t.percent ?? "?"}%: ${money(t.amountCents)}`).join(" · ")}</p>}</> : <p className="mt-2 text-sm">These items cannot be represented safely. See the review issues.</p>}</section>;
}
export type InvoiceCheck = Review;
export function InvoiceReconciliationControls({ orderId, review, checking, error, onRefresh, invoiceActions }: { orderId: string; review: Review | null; checking: boolean; error: string | null; onRefresh: () => Promise<void>; invoiceActions?: ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState(false), [choice, setChoice] = useState<"zoho" | "crm" | null>(null), [confirmed, setConfirmed] = useState(false), [receipt, setReceipt] = useState(false), [actionError, setActionError] = useState<string | null>(null), [pending, start] = useTransition();
  function show() { setChoice(null); setConfirmed(false); setReceipt(false); setActionError(null); setOpen(true); }
  function apply(deposit = false, reuseOnly = false) {
    if (!review) return;
    start(async () => {
      const result = deposit
        ? await confirmInvoiceDepositUi({ orderId, fingerprint: review.fingerprint, confirm: receipt, reuseOnly, paymentId: reuseOnly ? review.verifiedPaymentId : undefined })
        : await applyInvoiceReconciliationUi({ orderId, fingerprint: review.fingerprint, choice, confirm: confirmed });
      if (!result.ok) { setActionError(result.error); await onRefresh(); return; }
      setOpen(false); setActionError(null); toast.success(deposit ? "Existing invoice and deposit verified." : "Invoice details updated; historical quotation preserved.");
      router.refresh(); await onRefresh();
    });
  }
  if (checking) return <p role="status" className="mt-4 text-sm text-slate-600">Checking Zoho invoice and deposit…</p>;
  if (error) return <div className="mt-4 rounded border border-red-200 bg-red-50 p-3"><p role="alert" className="text-sm text-red-800">{error}</p><Button className="mt-2 h-11" variant="outline" onClick={() => void onRefresh()}>Retry Zoho check</Button></div>;
  if (!review) return null;
  if (!review.hasInvoice) return review.canConfirmDeposit ? <div className="mt-4 border-t pt-4"><p className="text-sm">No invoice exists yet. Confirm receipt to create the invoice and record the deposit.</p>{actionError && <p role="alert" className="text-red-800">{actionError}</p>}<label className="my-3 flex gap-2 text-sm"><input type="checkbox" checked={receipt} onChange={event => setReceipt(event.target.checked)} />I confirm receipt of {money(review.depositCents)} for the CRM order total of {money(review.orderTotalCents)}.</label><Button className="h-11" disabled={pending || !receipt} onClick={() => apply(true)}>Confirm deposit received</Button></div> : null;
  const canContinue = review.equal && review.paymentVerified && review.canConfirmDeposit && ["order_recorded", "quotation_sent"].includes(review.orderStage);
  return <div className="mt-4 border-t pt-4">
    <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-semibold text-slate-900">{review.equal ? "Invoice synced" : "Invoice differences found"}</p><p className="mt-1 text-sm text-slate-600">{review.invoiceNumber} · {money(review.zoho?.totalCents ?? null)} · {review.invoiceStatus}</p></div></div>
    <p className="mt-2 text-sm text-slate-700">{review.paymentVerified ? `Deposit ${money(review.depositCents)} verified in Zoho` : review.paymentCheckError ?? "A matching deposit payment has not been verified in Zoho."}</p>
    {review.orderStage === "deposit_received" && <p role="status" className="mt-2 font-medium text-emerald-700">Deposit Received</p>}
    {actionError && <p role="alert" className="mt-2 text-sm text-red-800">{actionError}</p>}
    {review.busy && <p className="mt-2 text-sm text-slate-600">An operation is in progress. Wait and refresh.</p>}
    <div className="mt-3 flex flex-wrap gap-2">
      {!review.equal && <Button className="h-11" disabled={pending || review.busy} onClick={show}>Resolve differences</Button>}
      {canContinue && <Button className="h-11" disabled={pending || review.busy} onClick={() => apply(true, true)}>{pending ? "Continuing…" : "Continue to Deposit Received"}</Button>}
      {review.equal && !review.paymentVerified && review.canRecordDeposit && review.canConfirmDeposit && <Button className="h-11" disabled={pending || review.busy} onClick={show}>Confirm deposit received</Button>}
      {review.paymentCheckError && <Button className="h-11" variant="outline" disabled={pending} onClick={() => void onRefresh()}>Retry deposit check</Button>}
    </div>
    {review.equal && <details className="mt-3 text-sm"><summary className="cursor-pointer text-slate-600">Invoice details</summary><div className="mt-2"><CommercialDetails document={review.zoho} title="Current Zoho invoice" />{invoiceActions}</div></details>}
    <Dialog open={open} onOpenChange={value => { if (!pending) setOpen(value); }}><DialogContent className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-5xl"><DialogHeader className="border-b p-4 pr-12 text-left"><DialogTitle>{review.equal ? "Invoice details" : "Resolve invoice differences"}</DialogTitle><DialogDescription>Historical quotation, PDF and manufacturing measurements are preserved.</DialogDescription></DialogHeader>
    <div className="min-h-0 space-y-4 overflow-y-auto p-4">
      {review.orderStage === "deposit_received" && <p role="status" className="mt-2 font-medium text-emerald-700">Deposit Received</p>}
    {actionError && <p role="alert" className="text-sm text-red-800">{actionError}</p>}
      <p className="text-sm">CRM order {money(review.orderTotalCents)} · Deposit {money(review.depositCents)} · Historical quotation {money(review.historicalQuoteTotalCents)}</p>
      <p className="text-sm">Current in Zoho: paid {money(review.paidCents)} · balance {money(review.balanceCents)} · credits {money(review.creditsCents)}</p>
      {review.issues.map(issue => <p key={issue} className="text-sm text-red-800">{issue}</p>)}
      {!review.equal && review.admin && review.sourceAllowed && <div className="grid gap-3 sm:grid-cols-2"><Button className="h-auto min-h-12 whitespace-normal p-3" variant={choice === "zoho" ? "default" : "outline"} disabled={!review.zoho || review.zoho.totalCents < review.depositCents || review.busy} onClick={() => { setChoice("zoho"); setConfirmed(false); }}>Use Zoho invoice details in CRM</Button><div><Button className="h-auto min-h-12 w-full whitespace-normal p-3" variant={choice === "crm" ? "default" : "outline"} disabled={review.updateIssues.length > 0 || review.busy || review.mutationBlocked} onClick={() => { setChoice("crm"); setConfirmed(false); }}>Update Zoho invoice from CRM</Button>{review.updateIssues.map(issue => <p key={issue} className="mt-1 text-xs text-slate-600">{issue}</p>)}</div></div>}
      {!review.equal && !review.admin && <p className="text-sm">Ask an admin to choose the financial source after reviewing these differences.</p>}
      {!review.sourceAllowed && <p className="text-sm">This order is past financial reconciliation. These details are read-only.</p>}
      {!review.equal && <div className="grid gap-3 sm:grid-cols-2"><CommercialDetails document={review.crm} title={review.basis} /><CommercialDetails document={review.zoho} title="Current Zoho invoice" /></div>}
      {choice && <label className="flex gap-2 rounded border p-3 text-sm"><input type="checkbox" className="mt-1" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /><span>{choice === "zoho" ? `Use these items in CRM and ${review.orderTotalCents === review.zoho?.totalCents ? `keep the order total at ${money(review.orderTotalCents)}` : `change the order total from ${money(review.orderTotalCents)} to ${money(review.zoho?.totalCents ?? null)}`}.` : `Update the same unpaid invoice ${review.invoiceNumber} from CRM.`} Keep the recorded deposit, existing payments, historical quotation and manufacturing measurements unchanged.</span></label>}
      {review.equal && !review.paymentVerified && review.canRecordDeposit && review.canConfirmDeposit && <label className="flex gap-2 rounded border p-3 text-sm"><input type="checkbox" className="mt-1" checked={receipt} onChange={event => setReceipt(event.target.checked)} /><span>I confirm receipt of {money(review.depositCents)}. Reuse a matching payment if found; record it only if safely verified absent. {review.orderStage === "order_recorded" ? "Recover directly to Deposit Received without adding a quotation-sent event." : review.orderStage === "deposit_received" ? "Keep the current order stage." : "Move this order to Deposit Received."}</span></label>}
    </div><div className="flex flex-col gap-2 border-t bg-white p-4 sm:flex-row sm:justify-end"><Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>Close</Button>{!review.equal && review.admin && review.sourceAllowed && <Button disabled={pending || review.busy || !choice || !confirmed || (review.mutationBlocked && choice !== "zoho")} onClick={() => apply()}>Confirm selected source</Button>}{review.equal && !review.paymentVerified && review.canRecordDeposit && review.canConfirmDeposit && <Button disabled={pending || review.busy || !receipt} onClick={() => apply(true)}>Confirm deposit received</Button>}</div>
    </DialogContent></Dialog>
  </div>;
}
