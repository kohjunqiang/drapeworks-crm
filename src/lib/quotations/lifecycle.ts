import type { FulfilmentStatus } from "@/lib/db/schema";
import { UserFacingError } from "@/lib/user-facing-error";
import type { QuotationLineInput } from "@/lib/validation/quotation";

export const QUOTATION_FINAL_MESSAGE = "This quotation is final — the deposit has been recorded";

// A quotation is editable only while the order is in the quotation stage.
// order_recorded is the first status in STATUS_FLOW, so anything else means
// the deposit has already converted the estimate to an invoice.
export function assertQuotationStage(status: FulfilmentStatus): void {
  if (status !== "order_recorded" && status !== "quotation_sent") throw new UserFacingError(QUOTATION_FINAL_MESSAGE);
}

// Zoho lets a sent/accepted/declined/expired estimate be edited; once it has
// been converted to an invoice the invoice is the document of record.
export function assertEstimateEditable(remote: { status: string; invoice_ids?: string[] }): void {
  if (remote.status === "invoiced" || (remote.invoice_ids?.length ?? 0) > 0) {
    throw new UserFacingError("This quotation has already been invoiced in Zoho and can no longer be changed.");
  }
}

// Marking an estimate sent bumps Zoho's last_modified_time without changing
// its content, so a moved timestamp alone is not drift. Drift means the
// remote content matches neither what we last synced nor what we are about
// to push.
export function hasZohoDrift(input: {
  storedModified: string | null;
  remoteModified: string | null | undefined;
  remoteHash: string;
  storedHash: string | null;
  payloadHash: string;
}): boolean {
  if (!input.storedModified || !input.remoteModified || input.remoteModified === input.storedModified) return false;
  return input.remoteHash !== input.storedHash && input.remoteHash !== input.payloadHash;
}

export function quotationBreakdown(lines: QuotationLineInput[]): string {
  return lines.map((line) => `${line.name}: ${line.quantity} × $${(line.rateCents / 100).toFixed(2)}`).join("\n");
}
