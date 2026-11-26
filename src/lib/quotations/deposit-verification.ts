import "server-only";
import { getZohoCustomerPayment, listZohoCustomerPayments } from "@/lib/zoho/books";
import { UserFacingError } from "@/lib/user-facing-error";

export async function findDepositPayment(input: {
  customerId: string;
  invoiceId: string;
  invoiceNumber: string | null;
  amountCents: number;
  referenceNumber: string;
  accountId: string;
}): Promise<{ payment_id: string; payment_number?: string } | null> {
  const summaries = await listZohoCustomerPayments(input.customerId);
  // List summaries may omit invoice allocations. Fetch every customer payment
  // before deciding that no matching deposit exists.
  const candidates = [...new Map(summaries.map(payment => [payment.payment_id, payment])).values()];
  const applied = [];
  for (const summary of candidates) {
    const payment = await getZohoCustomerPayment(summary.payment_id);
    if (payment.payment_id !== summary.payment_id || payment.customer_id !== input.customerId || !Array.isArray(payment.invoices)) throw new UserFacingError("A Zoho payment could not be verified. Reconcile existing payments before continuing.");
    if (payment.reference_number === input.referenceNumber && !payment.invoices.some(invoice => invoice.invoice_id === input.invoiceId)) throw new UserFacingError("The CRM deposit reference is attached to another payment allocation. Reconcile it in Zoho before continuing.");
    if (payment.invoices?.some((invoice) => invoice.invoice_id === input.invoiceId)) applied.push(payment);
  }
  if (applied.length === 0) return null;
  if (applied.length > 1) throw new UserFacingError("Multiple Zoho payments are applied to this invoice; reconcile them in Zoho Books before continuing");
  const payment = applied[0];
  const invoice = payment.invoices?.find((candidate) => candidate.invoice_id === input.invoiceId);
  const paymentMatches = payment.customer_id === input.customerId
    && Math.round(Number(payment.amount) * 100) === input.amountCents
    && Math.round(Number(invoice?.amount_applied) * 100) === input.amountCents
    && payment.payment_mode?.toLowerCase() === "paynow"
    && (!payment.account_id || payment.account_id === input.accountId);
  if (!paymentMatches) throw new UserFacingError("The Zoho invoice already has a payment that does not match the CRM deposit, PayNow mode, or MariBank account");
  return { payment_id: payment.payment_id, payment_number: payment.payment_number };
}


export async function verifyExistingDepositPayment(input: Parameters<typeof findDepositPayment>[0] & { storedPaymentId?: string | null }) {
  const found = await findDepositPayment(input);
  if (found && input.storedPaymentId && found.payment_id !== input.storedPaymentId) throw new UserFacingError("The stored payment and the matching invoice payment differ. Reconcile the payment links first.");
  const id = input.storedPaymentId ?? found?.payment_id;
  if (!id) return null;
  const verified = await getZohoCustomerPayment(id);
  const allocation = verified.invoices?.find(invoice => invoice.invoice_id === input.invoiceId);
  if (verified.payment_id !== id || verified.customer_id !== input.customerId || verified.payment_mode?.toLowerCase() !== "paynow" || Math.round(Number(verified.amount) * 100) !== input.amountCents || Math.round(Number(allocation?.amount_applied) * 100) !== input.amountCents || (verified.account_id && verified.account_id !== input.accountId)) throw new UserFacingError("The Zoho payment does not match this invoice, deposit, PayNow mode or MariBank account.");
  return { payment_id: verified.payment_id, payment_number: verified.payment_number ?? null };
}
