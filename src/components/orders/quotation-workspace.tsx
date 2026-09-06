"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Download, ExternalLink, Plus, RefreshCw, Share2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  confirmQuotationSent,
  acknowledgeZohoConflict,
  confirmZohoCustomer,
  createAndConfirmZohoCustomer,
  createQuotationRevision,
  getQuotationPdfUrl,
  getZohoQuotationOptions,
  recoverStaleQuotationClaim,
  reconcileUncertainQuotation,
  saveQuotation,
  searchZohoCustomers,
  syncQuotation,
} from "@/lib/actions/quotations";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DEFAULT_QUOTATION_TERMS, defaultCustomerMessage, isGeneratedCustomerMessage, quotationTotalCents } from "@/lib/quotations/model";
import type { QuotationLineInput } from "@/lib/validation/quotation";

type Quote = {
  id: string; revision: number; status: string; issueDate: string; expiryDate: string;
  lines: QuotationLineInput[]; totalCents: number; customerMessage: string; notes: string; terms: string;
  estimateNumber: string | null; invoiceNumber: string | null; updatedAt: string; syncError: string | null;
  invoiceSyncState: string; invoiceSyncError: string | null; hasZohoEstimate: boolean; hasPdf: boolean; sentAt: string | null;
};

type Props = {
  orderId: string; displayId: string; customerName: string; productLine: "curtain" | "mesh"; quotedCents: number;
  quote: Quote | null; history: Array<{ id: string; revision: number; estimateNumber: string | null; sentAt: string | null; supersededAt: string | null; totalCents: number; hasPdf: boolean }>;
  linkedContactId: string | null; canManage: boolean; configured: boolean;
};

type Options = Awaited<ReturnType<typeof getZohoQuotationOptions>>;

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Singapore", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const plusDays = (date: string, days: number) => {
  const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10);
};
const money = (cents: number) => new Intl.NumberFormat("en-SG", { style: "currency", currency: "SGD" }).format(cents / 100);

function initialLines(quote: Quote | null, quotedCents: number, productLine: Props["productLine"]): QuotationLineInput[] {
  return quote?.lines ?? [{ zohoItemId: null, name: productLine === "mesh" ? "Mesh" : "Curtains and blinds", description: "", quantity: 1, rateCents: quotedCents, discountPercent: 0 }];
}

export function QuotationWorkspace(props: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [options, setOptions] = useState<Options | null>(null);
  const [lines, setLines] = useState(() => initialLines(props.quote, props.quotedCents, props.productLine));
  const [issueDate, setIssueDate] = useState(props.quote?.issueDate ?? today());
  const [expiryDate, setExpiryDate] = useState(props.quote?.expiryDate ?? plusDays(today(), 7));
  const [message, setMessage] = useState(props.quote?.customerMessage ?? defaultCustomerMessage({ customerName: props.customerName, displayId: props.displayId, totalCents: props.quotedCents, expiryDate: plusDays(today(), 7) }));
  const [notes, setNotes] = useState(props.quote?.notes ?? "");
  const [terms, setTerms] = useState(props.quote?.terms ?? DEFAULT_QUOTATION_TERMS);
  const [dirty, setDirty] = useState(false);
  const [messageCustomized, setMessageCustomized] = useState(() => {
    if (!props.quote?.customerMessage) return false;
    return !isGeneratedCustomerMessage(
      props.quote.customerMessage,
      {
        customerName: props.customerName,
        totalCents: props.quote.totalCents,
        expiryDate: props.quote.expiryDate,
      },
      [props.displayId, ...(props.quote.estimateNumber ? [props.quote.estimateNumber] : [])],
    );
  });
  const [preview, setPreview] = useState<{ url: string; fileName: string } | null>(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [channel, setChannel] = useState("WhatsApp");
  const [sendNote, setSendNote] = useState("");
  const [matchingOpen, setMatchingOpen] = useState(!props.linkedContactId);
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerMatches, setCustomerMatches] = useState<Options["candidates"] | null>(null);
  const total = useMemo(() => quotationTotalCents(lines), [lines]);
  const generatedMessage = defaultCustomerMessage({ customerName: props.customerName, displayId: props.quote?.estimateNumber ?? props.displayId, totalCents: total, expiryDate });
  const displayedMessage = messageCustomized ? message : generatedMessage;
  const messageStale = messageCustomized && message !== generatedMessage;

  useEffect(() => {
    if (!props.configured) return;
    start(async () => {
      try { setOptions(await getZohoQuotationOptions(props.orderId)); }
      catch (error) { toast.error(error instanceof Error ? error.message : "Could not load Zoho Books"); }
    });
  }, [props.configured, props.orderId]);

  function mutateLine(index: number, patch: Partial<QuotationLineInput>) {
    setLines((current) => current.map((line, i) => i === index ? { ...line, ...patch } : line)); setDirty(true);
  }
  function run(task: () => Promise<unknown>, success: string, clearDirty = false) {
    start(async () => {
      try { await task(); toast.success(success); if (clearDirty) setDirty(false); router.refresh(); }
      catch (error) { toast.error(error instanceof Error ? error.message : "Something went wrong"); }
    });
  }
  const save = () => saveQuotation({ orderId: props.orderId, quotationId: props.quote?.id ?? null, expectedUpdatedAt: props.quote?.updatedAt ?? null, issueDate, expiryDate, lines, customerMessage: displayedMessage, notes, terms });

  async function openPdf(download: boolean, quotationId = props.quote?.id) {
    if (!quotationId) return;
    try {
      const result = await getQuotationPdfUrl(quotationId, download);
      if (download) {
        const link = document.createElement("a"); link.href = result.url; link.download = result.fileName; link.click();
      } else setPreview(result);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not open quotation"); }
  }

  async function sharePdf() {
    if (!props.quote) return;
    try {
      const result = await getQuotationPdfUrl(props.quote.id, false);
      const blob = await (await fetch(result.url)).blob();
      const file = new File([blob], result.fileName, { type: "application/pdf" });
      if (!navigator.share || !navigator.canShare?.({ files: [file] })) throw new Error("Sharing files is not supported on this device");
      await navigator.share({ files: [file], title: result.fileName });
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not share quotation"); }
  }

  const synced = props.quote?.status === "zoho_draft" && !dirty;
  const sent = props.quote?.status === "sent";
  const processing = props.quote?.status === "syncing" || props.quote?.status === "sending";
  const statusText = sent ? "Sent quotation" : synced ? "Zoho draft ready" : props.quote?.status === "syncing" ? "Syncing with Zoho" : props.quote?.status === "sending" ? "Confirming sent with Zoho" : props.quote?.status === "conflict" ? "Needs reconciliation" : props.quote ? "Changes not synced" : "Local draft";

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="text-base font-semibold text-slate-900">Customer quotation</h2><p className="mt-1 text-sm text-slate-500">Version {props.quote?.revision ?? 1} · {statusText}</p></div>
        {props.quote?.estimateNumber && <span className="rounded-full bg-teal-50 px-3 py-1 text-xs font-medium text-teal-800">{props.quote.estimateNumber}</span>}
      </div>
      {!props.configured && <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Zoho Books is not ready. Local quote editing remains available, but an admin must reconnect Zoho Books before customer matching or official quotation generation.</p>}
      {props.quote?.syncError && <p role="alert" className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{props.quote.syncError}</p>}
      {dirty && props.quote?.estimateNumber && <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Changes not synced. Update the Zoho draft and refresh the PDF before sending.</p>}

      <div className="mt-5 border-t pt-5">
        <h3 className="text-sm font-semibold text-slate-900">Zoho customer</h3>
        {(props.linkedContactId || options?.linkedContactId) && !matchingOpen ? <div className="mt-2 text-sm text-emerald-700">Confirmed Zoho customer{options?.linkedContact ? <><strong> · {options.linkedContact.name}</strong><div className="text-xs text-slate-500">{[options.linkedContact.phone, options.linkedContact.email].filter(Boolean).join(" · ") || options.linkedContact.id}</div></> : <> · {props.linkedContactId ?? options?.linkedContactId}</>}{props.canManage && !props.quote?.estimateNumber && <Button className="ml-2 h-11" variant="outline" onClick={() => setMatchingOpen(true)}>Change Zoho customer</Button>}</div> : (
          <div className="mt-3 space-y-2">
            <p className="text-xs text-slate-500">Choose deliberately—customer names and phone numbers are not unique in Zoho.</p>
            <div className="flex gap-2"><Input className="h-11" placeholder="Search name, mobile or email" value={customerQuery} onChange={(e) => setCustomerQuery(e.target.value)} /><Button className="h-11" variant="outline" disabled={pending || customerQuery.trim().length < 2} onClick={() => start(async () => { try { setCustomerMatches(await searchZohoCustomers(props.orderId, customerQuery)); } catch (error) { toast.error(error instanceof Error ? error.message : "Search failed"); } })}>Search</Button></div>
            {(customerMatches ?? options?.candidates ?? []).map((candidate) => <div key={candidate.id} className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between"><div className="text-sm"><strong>{candidate.name}</strong><div className="text-xs text-slate-500">{[candidate.company, candidate.phone, candidate.email].filter(Boolean).join(" · ") || "No contact details"}</div></div>{props.canManage && <Button className="h-11" variant="outline" disabled={pending} onClick={() => run(async () => { await confirmZohoCustomer({ orderId: props.orderId, zohoContactId: candidate.id }); setMatchingOpen(false); }, "Zoho customer confirmed")}>Confirm match</Button>}</div>)}
            {customerMatches?.length === 0 && <p className="rounded border border-slate-200 p-3 text-sm text-slate-500">No matching Zoho customers found. Try a mobile number, email, or another spelling.</p>}
            {props.canManage && <Button className="h-11" variant="outline" disabled={pending || !options} onClick={() => { if (window.confirm(`Create a new Zoho customer for ${props.customerName}? Check the matches above first to avoid duplicates.`)) run(() => createAndConfirmZohoCustomer(props.orderId), "Zoho customer created and linked"); }}>Create new Zoho customer</Button>}
          </div>
        )}
      </div>

      <fieldset disabled={!props.canManage || sent || pending} className="mt-5 space-y-4 border-t pt-5 disabled:opacity-70">
        <legend className="sr-only">Quotation details</legend>
        <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm font-medium">Issue date<Input className="mt-1 h-11" type="date" value={issueDate} onChange={(e) => { setIssueDate(e.target.value); setDirty(true); }} /></label><label className="text-sm font-medium">Valid until<Input className="mt-1 h-11" type="date" value={expiryDate} onChange={(e) => { setExpiryDate(e.target.value); setDirty(true); }} /></label></div>
        <div className="space-y-3">
          {lines.map((line, index) => <div key={index} className="rounded-lg border border-slate-200 p-3">
            <div className="flex items-start gap-2"><label className="flex-1 text-xs font-medium text-slate-600">Catalogue item<select className="mt-1 h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" value={line.zohoItemId ?? ""} onChange={(e) => { const item = options?.items.find((row) => row.id === e.target.value); mutateLine(index, item ? { zohoItemId: item.id, name: item.name, description: item.description, rateCents: item.rateCents } : { zohoItemId: null }); }}><option value="">Custom line</option>{options?.items.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>{lines.length > 1 && <Button aria-label="Remove line" className="mt-6 h-11 w-11" variant="ghost" onClick={() => { setLines((v) => v.filter((_, i) => i !== index)); setDirty(true); }}><Trash2 /></Button>}</div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-xs font-medium text-slate-600">Line name<Input className="mt-1 h-11" disabled={Boolean(line.zohoItemId)} title={line.zohoItemId ? "Catalogue names come from Zoho Books" : undefined} value={line.name} onChange={(e) => mutateLine(index, { name: e.target.value })} /></label><label className="text-xs font-medium text-slate-600">Description<Input className="mt-1 h-11" value={line.description} onChange={(e) => mutateLine(index, { description: e.target.value })} /></label><label className="text-xs font-medium text-slate-600">Quantity<Input className="mt-1 h-11" type="number" min="0.01" step="0.01" value={line.quantity} onChange={(e) => mutateLine(index, { quantity: Number(e.target.value) })} /></label><label className="text-xs font-medium text-slate-600">Rate (SGD)<Input className="mt-1 h-11" type="number" min="0" step="0.01" value={line.rateCents / 100} onChange={(e) => mutateLine(index, { rateCents: Math.round(Number(e.target.value) * 100) })} /></label><label className="text-xs font-medium text-slate-600">Discount %<Input className="mt-1 h-11" type="number" min="0" max="100" step="0.01" value={line.discountPercent} onChange={(e) => mutateLine(index, { discountPercent: Number(e.target.value) })} /></label></div>
          </div>)}
          <Button className="h-11" variant="outline" onClick={() => { setLines((v) => [...v, { zohoItemId: null, name: "", description: "", quantity: 1, rateCents: 0, discountPercent: 0 }]); setDirty(true); }}><Plus /> Add line</Button>
        </div>
        <div className="flex justify-between border-y py-3 text-base font-semibold"><span>Total</span><span>{money(total)}</span></div>
        <label className="block text-sm font-medium">Customer message<div className="mt-1 flex gap-2"><Textarea rows={5} value={displayedMessage} onChange={(e) => { setMessage(e.target.value); setMessageCustomized(true); setDirty(true); }} /><Button type="button" aria-label="Copy message" className="h-11 w-11" variant="outline" onClick={async () => { try { await navigator.clipboard.writeText(displayedMessage); toast.success("Message copied"); } catch { toast.error("Could not copy the message"); } }}><Copy /></Button></div>{messageStale && <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-amber-700">This custom message differs from the current amount, date, or quote number.<Button type="button" size="sm" variant="outline" onClick={() => { setMessage(generatedMessage); setMessageCustomized(false); setDirty(true); }}>Reset to generated message</Button></span>}</label>
        <details><summary className="cursor-pointer text-sm font-medium text-teal-700">Notes and terms</summary><div className="mt-3 space-y-3"><label className="block text-sm">Notes<Textarea className="mt-1" value={notes} onChange={(e) => { setNotes(e.target.value); setDirty(true); }} /></label><label className="block text-sm">Terms<Textarea className="mt-1" value={terms} onChange={(e) => { setTerms(e.target.value); setDirty(true); }} /></label></div></details>
      </fieldset>

      <div className="-mx-4 mt-5 flex flex-col gap-2 border-t bg-white px-4 py-3 sm:-mx-6 sm:flex-row sm:flex-wrap sm:px-6">
        {props.canManage && !sent && !processing && <Button className="h-11" variant="outline" disabled={pending} onClick={() => run(save, "Local quotation saved", true)}>Save draft</Button>}
        {props.canManage && props.quote && !sent && !processing && props.quote.status !== "conflict" && <Button className="h-11" disabled={pending || !props.configured || !(props.linkedContactId || options?.linkedContactId)} onClick={() => run(async () => { if (dirty) await save(); await syncQuotation(props.quote!.id); }, synced ? "Zoho draft refreshed" : "Zoho draft created", true)}>{pending ? <RefreshCw className="animate-spin" /> : <ExternalLink />} {props.quote.estimateNumber ? "Update Zoho draft & refresh PDF" : "Create Zoho draft & preview"}</Button>}
        {props.quote?.hasPdf && !dirty && (synced || sent) && <><Button className="h-11" variant="outline" onClick={() => openPdf(false)}><ExternalLink /> Preview official quotation</Button><Button aria-label="Download official quotation" className="h-11 w-11" variant="outline" onClick={() => openPdf(true)}><Download /></Button><Button aria-label="Share official quotation" className="h-11 w-11" variant="outline" onClick={sharePdf}><Share2 /></Button></>}
        {props.canManage && synced && <Button className="h-11" onClick={() => setSendOpen(true)}>Confirm quotation sent</Button>}
        {props.canManage && props.quote?.status === "conflict" && (props.quote.hasZohoEstimate ? <Button className="h-11" variant="destructive" onClick={() => { if (window.confirm("Reconcile now? A Zoho draft will be overwritten from the CRM and its PDF regenerated. An already-sent Zoho quotation will be imported with its exact PDF for final CRM confirmation.")) run(() => acknowledgeZohoConflict(props.quote!.id), "Zoho quotation reconciled"); }}>Reconcile with Zoho</Button> : <Button className="h-11" variant="destructive" onClick={() => run(() => reconcileUncertainQuotation(props.quote!.id), "Zoho checked for the interrupted quotation")}>Check Zoho before retrying creation</Button>)}
        {props.canManage && processing && <Button className="h-11" variant="outline" disabled={pending} onClick={() => run(() => recoverStaleQuotationClaim(props.quote!.id), "Zoho operation checked")}>Check Zoho status / resume reconciliation</Button>}
        {props.canManage && sent && <Button className="h-11" onClick={() => run(() => createQuotationRevision(props.quote!.id), "Revision created")}>Create revised quotation</Button>}
      </div>

      {props.quote?.invoiceNumber && <p className="mt-3 text-sm text-emerald-700">Zoho invoice {props.quote.invoiceNumber} was created when the deposit was recorded.</p>}
      {props.quote?.invoiceSyncState === "pending" && <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Zoho invoice creation is still pending. Wait a moment, then use the deposit action above to check and continue.</p>}
      {props.quote?.invoiceSyncState === "uncertain" && <div role="alert" className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"><p className="font-medium">Zoho may have created the invoice</p><p className="mt-1 text-xs">{props.quote.invoiceSyncError ?? "The conversion response was interrupted."}</p><a href="#advance-order-status" className="mt-2 inline-block font-medium underline">Check Zoho again with the deposit action above</a></div>}
      {props.quote?.invoiceSyncState === "failed" && <div role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900"><p className="font-medium">Zoho invoice needs attention</p><p className="mt-1 text-xs">{props.quote.invoiceSyncError ?? "The last invoice attempt could not be confirmed."}</p><a href="#advance-order-status" className="mt-2 inline-block font-medium underline">Retry or reconcile with the deposit action above</a></div>}
      {props.history.length > 0 && <details className="mt-4 text-sm"><summary className="cursor-pointer font-medium text-slate-700">Earlier versions ({props.history.length})</summary><ul className="mt-2 space-y-2 text-slate-500">{props.history.map((item) => <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-2"><span>Version {item.revision} · {item.estimateNumber ?? "local"} · {money(item.totalCents)} · superseded {item.supersededAt ? new Date(item.supersededAt).toLocaleString("en-SG") : "—"}</span>{item.hasPdf && <span className="flex gap-1"><Button size="sm" variant="outline" onClick={() => openPdf(false, item.id)}>Preview</Button><Button size="sm" variant="outline" onClick={() => openPdf(true, item.id)}>Download</Button></span>}</li>)}</ul></details>}

      <Dialog open={sendOpen} onOpenChange={setSendOpen}><DialogContent><DialogHeader><DialogTitle>Confirm quotation sent</DialogTitle><DialogDescription>This records that you sent the already-reviewed PDF. It does not send a message from Zoho.</DialogDescription></DialogHeader><label className="text-sm font-medium">Channel<select className="mt-1 h-11 w-full rounded-md border px-3" value={channel} onChange={(e) => setChannel(e.target.value)}><option>WhatsApp</option><option>Email</option><option>In person</option><option>Other</option></select></label><label className="text-sm font-medium">Note (optional)<Textarea className="mt-1" value={sendNote} onChange={(e) => setSendNote(e.target.value)} /></label><DialogFooter><Button className="h-11" disabled={pending} onClick={() => run(async () => { await confirmQuotationSent({ quotationId: props.quote!.id, channel, note: sendNote }); setSendOpen(false); }, "Quotation marked as sent")}>I have sent this quotation</Button></DialogFooter></DialogContent></Dialog>
      <Dialog open={Boolean(preview)} onOpenChange={(open) => { if (!open) setPreview(null); }}><DialogContent className="h-[90dvh] max-w-4xl"><DialogHeader><DialogTitle>{preview?.fileName}</DialogTitle><DialogDescription>Official Zoho quotation—the same stored PDF used for download and share.</DialogDescription></DialogHeader>{preview && <iframe title="Official quotation preview" src={preview.url} className="min-h-0 w-full flex-1 rounded border" />}<DialogFooter><Button variant="outline" onClick={() => preview && window.open(preview.url, "_blank", "noopener,noreferrer")}>Open in new tab</Button><Button onClick={() => { if (!preview) return; const link = document.createElement("a"); link.href = preview.url; link.download = preview.fileName; link.click(); }}>Download</Button></DialogFooter></DialogContent></Dialog>
    </section>
  );
}
