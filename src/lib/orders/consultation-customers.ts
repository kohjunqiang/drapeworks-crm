import "server-only";

import { db } from "@/lib/db/kysely";
import { ATTEND_APPOINTMENT_STAGE } from "@/lib/leads/funnel-types";

import {
  PRE_DEPOSIT_ORDER_STATUSES,
  type ConsultationProduct,
} from "./consultation-selection";

/**
 * Attend Appointment leads with a scheduled booking and no order yet — the
 * "Appointment leads" optgroup in the consultation picker. A new scheduled
 * lead qualifies on its own row only: an old paid order on the same customer
 * can never disqualify it, because the gate is THIS lead having no order.
 */
export async function loadConsultationLeadRows() {
  return db
    .selectFrom("leads")
    .leftJoin("orders", "orders.lead_id", "leads.id")
    .innerJoin("appointments", (join) => join
      .onRef("appointments.lead_id", "=", "leads.id")
      .on("appointments.status", "=", "scheduled"))
    .innerJoin("customers", "customers.id", "appointments.customer_id")
    .select([
      "leads.id as lead_id", "leads.name as lead_name",
      "customers.id as customer_id",
      "customers.mobile as customer_mobile",
      "appointments.development as appointment_development",
      "leads.development as lead_development",
    ])
    .where("leads.is_archived", "=", false)
    .where("leads.funnel_stage", "=", ATTEND_APPOINTMENT_STAGE)
    .where("orders.id", "is", null)
    .orderBy("leads.updated_at", "desc")
    .execute();
}

/**
 * Customers reusable for another consultation — the "Existing customers"
 * optgroup. Restricted to pre-deposit orders (see PRE_DEPOSIT_ORDER_STATUSES):
 * a customer whose only orders already took a deposit is excluded, and a
 * recently updated paid order can't eclipse an older unpaid one because
 * distinctOn picks the latest ELIGIBLE row, not the latest row overall.
 * Eligibility stays cross-product, as before.
 */
export async function loadRepeatCustomerRows() {
  return db
    .selectFrom("customers")
    .innerJoin("orders", "orders.customer_id", "customers.id")
    .select([
      "customers.id as customer_id",
      "customers.name as customer_name",
      "customers.mobile as customer_mobile",
      "orders.development",
    ])
    .distinctOn("customers.id")
    .where("orders.current_status", "in", PRE_DEPOSIT_ORDER_STATUSES)
    .orderBy("customers.id")
    .orderBy("orders.updated_at", "desc")
    .execute();
}

/**
 * Identity + address prefill for a returning customer remembered by the
 * product-scoped cookie. Only pre-deposit orders qualify — a cookie left over
 * from a customer whose orders have all since taken a deposit resolves to
 * undefined, so the form opens as a brand-new consultation rather than
 * resurrecting a paid customer. Address comes from the most recent unpaid
 * order of the CURRENT product when one exists, falling back to the latest
 * unpaid order of the other product.
 */
export async function loadUnpaidCustomerPrefill(
  customerId: string,
  product: ConsultationProduct,
): Promise<
  | {
      customerId: string;
      customer: {
        name: string;
        salutation?: string;
        mobile: string;
        email?: string;
      };
      development: string | null;
      address: string | null;
    }
  | undefined
> {
  const rows = await db
    .selectFrom("customers")
    .innerJoin("orders", "orders.customer_id", "customers.id")
    .select([
      "customers.id",
      "customers.name",
      "customers.salutation",
      "customers.mobile",
      "customers.email",
      "orders.development",
      "orders.site_address",
      "orders.product_line",
    ])
    .where("customers.id", "=", customerId)
    .where("orders.current_status", "in", PRE_DEPOSIT_ORDER_STATUSES)
    .orderBy("orders.updated_at", "desc")
    .execute();
  if (rows.length === 0) return undefined;
  const match = rows.find((row) => row.product_line === product) ?? rows[0];

  return {
    customerId: match.id,
    customer: {
      name: match.name,
      salutation: match.salutation ?? undefined,
      mobile: match.mobile,
      email: match.email ?? undefined,
    },
    development: match.development,
    address: match.site_address,
  };
}

export type BookedIdentity = {
  customer: {
    name: string;
    salutation?: string;
    mobile: string;
    email?: string;
  };
  development?: string | null;
  address?: string | null;
};

/**
 * Overlay the booked/selected identity and address onto template defaults
 * copied from an earlier consultation. The template supplies rooms and
 * measurements; the appointment or customer prefill supplies who this
 * consultation is for and where. An absent appointment field falls back to
 * the template value, so a booking with no address never blanks the copied
 * one — and a booking carrying no salutation keeps the template's.
 */
export function overlayAppointmentOntoDefaults<
  T extends {
    customer: { name: string; mobile: string; email?: string };
    order: { development?: string; site_address?: string };
  },
>(base: T, appointment: BookedIdentity): T {
  return {
    ...base,
    customer: {
      ...base.customer,
      name: appointment.customer.name,
      mobile: appointment.customer.mobile,
      email: appointment.customer.email ?? "",
      ...(appointment.customer.salutation === undefined
        ? {}
        : { salutation: appointment.customer.salutation }),
    },
    order: {
      ...base.order,
      development: appointment.development || base.order.development,
      site_address: appointment.address || base.order.site_address,
    },
  };
}
