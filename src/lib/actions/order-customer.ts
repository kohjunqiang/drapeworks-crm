import "server-only";

import type { Transaction } from "kysely";

import type { DB } from "@/lib/db/schema";
import { ATTEND_APPOINTMENT_STAGE } from "@/lib/leads/funnel-types";

export type ResolvedOrderCustomer = {
  customerId: string;
  appointmentId: string | null;
  leadId: string | null;
};

/**
 * Finishing a non-draft consultation is also the authoritative attendance
 * signal. Keep the appointment, lead stage, and analytics ledgers in the same
 * transaction as the order so the journey cannot be left half-finished.
 */
export async function completeAppointmentForOrder(
  trx: Transaction<DB>,
  appointmentId: string | null,
  leadId: string | null,
  userId: string,
): Promise<void> {
  if (!leadId) return;

  const occurredAt = new Date();
  const appointment = appointmentId
    ? await trx
        .selectFrom("appointments")
        .select(["lead_id", "scheduled_at", "status"])
        .where("id", "=", appointmentId)
        .where("lead_id", "=", leadId)
        .forUpdate()
        .executeTakeFirst()
    : undefined;

  if (appointmentId && !appointment) {
    throw new Error("This appointment is no longer available");
  }
  if (appointment?.status === "cancelled" || appointment?.status === "no_show") {
    throw new Error("A cancelled or no-show appointment cannot finish a consultation");
  }

  if (appointment?.status === "scheduled" && appointmentId) {
    await trx.updateTable("appointments")
      .set({ status: "completed", updated_at: occurredAt })
      .where("id", "=", appointmentId)
      .where("status", "=", "scheduled")
      .executeTakeFirstOrThrow();
    await trx.insertInto("appointment_events").values({
      appointment_id: appointmentId,
      lead_id: appointment.lead_id,
      event_type: "completed",
      occurred_at: occurredAt,
      scheduled_at: appointment.scheduled_at,
      created_by: userId,
    }).execute();
  }

  const lead = await trx.selectFrom("leads")
    .select("funnel_stage")
    .where("id", "=", leadId)
    .forUpdate()
    .executeTakeFirstOrThrow();

  await trx.updateTable("leads").set({
    funnel_stage: "Send Quotation",
    last_outcome: null,
    next_action_date: null,
    updated_at: occurredAt,
  }).where("id", "=", leadId).execute();

  if (lead.funnel_stage !== "Send Quotation") {
    await trx.insertInto("lead_stage_events").values({
      lead_id: leadId,
      from_stage: lead.funnel_stage,
      to_stage: "Send Quotation",
      changed_at: occurredAt,
      changed_by: userId,
      source: "system",
    }).execute();
  }
}

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
  selectedCustomerId?: string,
): Promise<ResolvedOrderCustomer> {
  if (selectedCustomerId && (appointmentId || leadId)) {
    throw new Error("Choose either an appointment lead or an existing customer");
  }

  // The lead picker carries only leadId. Resolve its one scheduled appointment
  // here so the order retains the booking/customer link and can complete it.
  const appointment = appointmentId || leadId
    ? await trx
        .selectFrom("appointments")
        .select(["id", "lead_id", "customer_id", "status"])
        .$if(Boolean(appointmentId), query => query.where("id", "=", appointmentId!))
        .$if(!appointmentId && Boolean(leadId), query =>
          query.where("lead_id", "=", leadId!).where("status", "=", "scheduled"))
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

  if (appointment && lead) {
    if (!lead.customer_id) {
      // Repair a legacy appointment whose customer link predates the lead's
      // customer_id. The appointment is already locked and is authoritative.
      await trx.updateTable("leads")
        .set({ customer_id: appointment.customer_id, updated_at: new Date() })
        .where("id", "=", lead.id)
        .execute();
    } else if (appointment.customer_id !== lead.customer_id) {
      throw new Error(
        "The appointment and selected lead belong to different customers",
      );
    }
  }

  const journeyCustomerId = appointment?.customer_id ?? lead?.customer_id;
  if (
    selectedCustomerId &&
    journeyCustomerId &&
    selectedCustomerId !== journeyCustomerId
  ) {
    throw new Error("The selected customer does not match this appointment");
  }

  const selectedCustomer = selectedCustomerId && !journeyCustomerId
    ? await trx
        .selectFrom("customers")
        .select("id")
        .where("id", "=", selectedCustomerId)
        .forUpdate()
        .executeTakeFirst()
    : undefined;
  if (selectedCustomerId && !journeyCustomerId && !selectedCustomer) {
    throw new Error("This customer is no longer available");
  }

  const existingCustomerId = journeyCustomerId ?? selectedCustomer?.id;
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
