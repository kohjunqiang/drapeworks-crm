import "server-only";

import type { Transaction } from "kysely";

import type { DB } from "@/lib/db/schema";
import { ATTEND_APPOINTMENT_STAGE } from "@/lib/leads/funnel-types";

export type ResolvedOrderCustomer = {
  customerId: string;
  appointmentId: string | null;
  leadId: string | null;
};

type SubmittedCustomer = {
  name: string;
  mobile: string;
  email?: string;
};

/**
 * Resolve the customer journey on the server. The dropdown is only guidance;
 * this transaction is the authority for lead eligibility and one-order-per-lead.
 */
export async function resolveOrderCustomer(
  trx: Transaction<DB>,
  appointmentId: string | undefined,
  leadId: string | undefined,
  customer: SubmittedCustomer,
  userId: string,
): Promise<ResolvedOrderCustomer> {
  const appointment = appointmentId
    ? await trx
        .selectFrom("appointments")
        .select(["id", "lead_id", "customer_id", "status"])
        .where("id", "=", appointmentId)
        .forUpdate()
        .executeTakeFirst()
    : undefined;

  if (appointmentId && !appointment) {
    throw new Error("This appointment is no longer available");
  }
  if (appointment && appointment.status !== "scheduled") {
    throw new Error("Only a scheduled appointment can start a consultation");
  }
  if (appointment && leadId && appointment.lead_id !== leadId) {
    throw new Error("The selected lead does not match this appointment");
  }

  const resolvedLeadId = appointment?.lead_id ?? leadId;
  const lead = resolvedLeadId
    ? await trx
        .selectFrom("leads")
        .select(["id", "customer_id", "funnel_stage", "is_archived"])
        .where("id", "=", resolvedLeadId)
        .forUpdate()
        .executeTakeFirst()
    : undefined;

  if (resolvedLeadId && (!lead || lead.is_archived)) {
    throw new Error("This lead is no longer available");
  }
  if (lead && lead.funnel_stage !== ATTEND_APPOINTMENT_STAGE) {
    throw new Error("Only a lead at Attend Appointment can start a consultation");
  }

  if (lead) {
    const existingOrder = await trx
      .selectFrom("orders")
      .select("id")
      .where("lead_id", "=", lead.id)
      .executeTakeFirst();
    if (existingOrder) {
      throw new Error("This lead already has an order");
    }
  }

  const existingCustomerId = appointment?.customer_id ?? lead?.customer_id;
  if (!existingCustomerId) {
    const inserted = await trx
      .insertInto("customers")
      .values({
        name: customer.name,
        mobile: customer.mobile,
        email: customer.email ?? null,
        created_by: userId,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    if (lead) {
      await trx
        .updateTable("leads")
        .set({ customer_id: inserted.id })
        .where("id", "=", lead.id)
        .execute();
    }
    return {
      customerId: inserted.id,
      appointmentId: appointment?.id ?? null,
      leadId: lead?.id ?? null,
    };
  }

  await trx
    .updateTable("customers")
    .set({
      name: customer.name,
      // Drafts may leave mobile blank; do not erase the booked number.
      ...(customer.mobile.trim().length > 0 ? { mobile: customer.mobile } : {}),
      email: customer.email ?? null,
    })
    .where("id", "=", existingCustomerId)
    .execute();

  return {
    customerId: existingCustomerId,
    appointmentId: appointment?.id ?? null,
    leadId: lead?.id ?? null,
  };
}
