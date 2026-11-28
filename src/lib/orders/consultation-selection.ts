import type { FulfilmentStatus } from "@/lib/db/schema";

export type ConsultationProduct = "curtain" | "mesh";

export function consultationCustomerCookie(product: ConsultationProduct): string {
  return `drapeworks-consultation-customer-${product}`;
}

/**
 * Order statuses that still count as "awaiting deposit" for consultation
 * reuse. A customer stays pickable while ANY of their orders sits at one of
 * these; once every order has reached deposit_received or later the
 * consultation is settled and they leave the dropdown. A positive
 * deposit_cents is only the quoted amount, never proof of receipt — status,
 * not money, is the gate. Draft orders carry order_recorded, so they qualify
 * without a special case.
 *
 * Shared by the picker query, the selection cookie action, the
 * existing-customer prefill and the measurement-template lookup — all four
 * must agree or the same customer would be pickable in one place and empty in
 * another.
 */
export const PRE_DEPOSIT_ORDER_STATUSES: readonly FulfilmentStatus[] = [
  "order_recorded",
  "quotation_sent",
];
