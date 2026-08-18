"use client";

// The purchase orders generated from an order's frozen measurements.
//
// Two jobs, and the second is the one that matters today. The first is to hand
// somebody the document — download on a desktop, the Web Share API on a phone,
// which is what puts it into WeChat, where the vendors actually are and why 微信
// is on the letterhead. The second is to explain, on the days there is no
// document at all, EXACTLY WHY NOT. That is the normal case right now: most of
// the Chinese labels are still null, generation refuses on each one, and this is
// the screen where a person finds that out. "No documents" would tell them
// nothing and send them to ask a developer.

import { useState, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  generateOrderPos,
  getPoDownloadUrl,
} from "@/lib/actions/procurement";

export type PoListItem = {
  id: string;
  /** The vendor's Latin name, or null if the vendor row has gone. */
  vendorName: string | null;
  vendorNameCn: string | null;
  /** Snapshot of order_reference at generation — what the PDF itself says. */
  poNumber: string;
  /** Preformatted on the server: this is Singapore's day, not the browser's. */
  generatedLabel: string;
  supersededLabel: string | null;
  notes: string | null;
};

const BUTTON =
  "px-3 py-1.5 text-sm border border-slate-300 rounded hover:bg-slate-50 " +
  "disabled:opacity-50 disabled:hover:bg-transparent whitespace-nowrap";

/**
 * Whether this device can share a file at all.
 *
 * Sharing is the point of this screen on a phone: it is what puts the PDF into
 * WeChat, which is how the vendors are actually reached. Desktop Chrome has
 * navigator.share on Android and ChromeOS only, so this resolves to
 * download-only on a laptop by itself, with no user-agent sniffing.
 */
function hasWebShare(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function" &&
    typeof navigator.canShare === "function"
  );
}

/** The capability never changes within a page's life, so there is nothing to
 *  subscribe to — useSyncExternalStore is here for its server snapshot. */
function subscribeNever(): () => void {
  return () => {};
}

async function fetchPo(poId: string): Promise<{ file: File; url: string }> {
  const { url, fileName } = await getPoDownloadUrl(poId);
  const response = await fetch(url);
  if (!response.ok) throw new Error("Could not fetch that purchase order.");
  const blob = await response.blob();
  return {
    file: new File([blob], fileName, { type: "application/pdf" }),
    url,
  };
}

function PoRow({ po }: { po: PoListItem }) {
  const [busy, setBusy] = useState(false);
  const canShare = useSyncExternalStore(
    subscribeNever,
    hasWebShare,
    // The server has no navigator, so it renders the desktop answer and the
    // button appears on the client pass. Reading navigator during render
    // instead would be a hydration mismatch.
    () => false,
  );

  const superseded = po.supersededLabel != null;

  async function download() {
    setBusy(true);
    try {
      const { url } = await fetchPo(po.id);
      // The signed URL already carries a Content-Disposition, so a plain anchor
      // downloads rather than navigating away from the order.
      const a = document.createElement("a");
      a.href = url;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not open that PO");
    } finally {
      setBusy(false);
    }
  }

  async function share() {
    setBusy(true);
    try {
      const { file } = await fetchPo(po.id);
      if (!navigator.canShare({ files: [file] })) {
        toast.error("This device cannot share a PDF. Download it instead.");
        return;
      }
      await navigator.share({ files: [file], title: `PO ${po.poNumber}` });
    } catch (e) {
      // Dismissing the share sheet throws AbortError. That is a person changing
      // their mind, not a failure, and a red toast for it is noise.
      if (e instanceof DOMException && e.name === "AbortError") return;
      toast.error(e instanceof Error ? e.message : "Could not share that PO");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={`border-t border-slate-100 px-4 py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between ${
        superseded ? "bg-slate-50/60" : ""
      }`}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span
            className={`text-sm font-semibold break-words ${
              superseded ? "line-through text-slate-400" : "text-slate-900"
            }`}
          >
            {po.vendorNameCn ?? po.vendorName ?? "Vendor no longer listed"}
          </span>
          {po.vendorNameCn && po.vendorName && (
            <span
              className={`text-xs break-words ${
                superseded ? "line-through text-slate-400" : "text-slate-500"
              }`}
            >
              {po.vendorName}
            </span>
          )}
          <span className="text-xs text-slate-500 tabular-nums">
            PO {po.poNumber}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-slate-500">
          Generated {po.generatedLabel}
          {po.supersededLabel && (
            <>
              {" · "}
              <span className="font-medium text-amber-800">
                superseded {po.supersededLabel}
              </span>
            </>
          )}
        </p>
        {po.notes && (
          <p className="mt-1 text-xs text-slate-600 break-words">
            <span className="font-medium">备注:</span> {po.notes}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {canShare && (
          <button type="button" onClick={share} disabled={busy} className={BUTTON}>
            Share
          </button>
        )}
        <button type="button" onClick={download} disabled={busy} className={BUTTON}>
          {busy ? "Opening…" : "Download"}
        </button>
      </div>
    </div>
  );
}

function RegenerateButton({
  orderId,
  hasDocuments,
}: {
  orderId: string;
  hasDocuments: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  function run() {
    startTransition(async () => {
      try {
        const { count } = await generateOrderPos(orderId);
        toast.success(
          `${count} purchase order${count === 1 ? "" : "s"} generated`,
        );
        setOpen(false);
        router.refresh();
      } catch (e) {
        // The refusal names every missing label, so it is worth reading in full
        // rather than being cut down to "Could not generate".
        toast.error(e instanceof Error ? e.message : "Could not generate", {
          duration: 12000,
        });
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={pending}
        className="px-3 py-1.5 text-sm bg-teal-600 hover:bg-teal-700 disabled:bg-slate-300 text-white rounded font-medium whitespace-nowrap"
      >
        {pending
          ? "Generating…"
          : hasDocuments
            ? "Regenerate"
            : "Generate purchase orders"}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {hasDocuments
                ? "Regenerate the purchase orders"
                : "Generate the purchase orders"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm text-slate-700">
            <p>
              This builds one document per vendor from the frozen measurements
              as they stand now.
            </p>
            {hasDocuments && (
              <ul className="list-disc pl-5 space-y-1">
                <li>
                  The documents already generated are{" "}
                  <span className="font-medium">superseded</span>. They stay
                  downloadable, because a vendor may already be working from
                  one.
                </li>
                <li>
                  <span className="font-medium">
                    No vendor is notified.
                  </span>{" "}
                  Whoever sent the old document has to send the new one, by
                  hand, the same way.
                </li>
              </ul>
            )}
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={pending}
                className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-900"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={run}
                disabled={pending}
                className="px-4 py-1.5 text-sm bg-teal-600 hover:bg-teal-700 disabled:bg-slate-300 text-white rounded font-medium"
              >
                {pending
                  ? "Generating…"
                  : hasDocuments
                    ? "Supersede and regenerate"
                    : "Generate"}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function PoList({
  orderId,
  pos,
  problems,
}: {
  orderId: string;
  pos: PoListItem[];
  /**
   * Why there is no current document, from the same loader generation uses.
   * Empty when the documents are up to date.
   */
  problems: string[];
}) {
  return (
    <div className="border border-slate-200 rounded overflow-hidden bg-white">
      <div className="bg-slate-50 px-4 py-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold text-slate-800">
          Purchase orders <span className="text-slate-500">采购订单</span>
        </span>
        <RegenerateButton orderId={orderId} hasDocuments={pos.length > 0} />
      </div>

      {problems.length > 0 && (
        <div className="border-t border-amber-200 bg-amber-50 px-4 py-4">
          <p className="text-sm font-medium text-amber-900">
            {pos.length === 0
              ? "No purchase order could be generated for this order."
              : "The documents below cannot be regenerated as things stand."}
          </p>
          <p className="mt-1 text-xs text-amber-900/80">
            Every cell of a 采购订单 is a cutting instruction, so anything the
            system does not know it refuses to print rather than leaving blank.
            Fix these and generate again:
          </p>
          <ul className="mt-2 space-y-1 text-sm text-amber-900">
            {problems.map((problem) => (
              <li key={problem}>⚠ {problem}</li>
            ))}
          </ul>
          <Link
            href="/admin/procurement"
            className="mt-3 inline-block text-sm font-medium text-teal-700 underline underline-offset-2 hover:text-teal-800"
          >
            Admin → Procurement
          </Link>
        </div>
      )}

      {pos.length === 0
        ? problems.length === 0 && (
            <div className="border-t border-slate-100 px-4 py-4">
              <p className="text-sm text-slate-600">
                No purchase order has been generated for this order yet.
                Everything one needs is in place, so generating now will produce
                it.
              </p>
            </div>
          )
        : pos.map((po) => <PoRow key={po.id} po={po} />)}
    </div>
  );
}
