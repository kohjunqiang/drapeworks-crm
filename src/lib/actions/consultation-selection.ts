"use server";

import { cookies } from "next/headers";
import { z } from "zod";

import { requireRole } from "@/lib/auth/require-role";
import { db } from "@/lib/db/kysely";
import {
  consultationCustomerCookie,
  PRE_DEPOSIT_ORDER_STATUSES,
} from "@/lib/orders/consultation-selection";

const selectionSchema = z.object({
  product: z.enum(["curtain", "mesh"]),
  customerId: z.string().uuid().nullable(),
});

/**
 * Returned rather than thrown for the stale-pick case: a thrown action error
 * reaches the browser as a generic digest in production, while this caller
 * needs the real reason to tell the consultant why their pick vanished.
 */
export type ConsultationSelectionResult =
  | { ok: true }
  | { ok: false; error: string };

/** Keep a returning-customer choice in the browser session, not in the URL. */
export async function setConsultationCustomer(
  input: unknown,
): Promise<ConsultationSelectionResult> {
  await requireRole(["consultant", "admin"]);
  const parsed = selectionSchema.parse(input);
  const cookieStore = await cookies();
  const name = consultationCustomerCookie(parsed.product);

  if (!parsed.customerId) {
    cookieStore.delete(name);
    return { ok: true };
  }

  const customer = await db
    .selectFrom("customers")
    .innerJoin("orders", "orders.customer_id", "customers.id")
    .select("customers.id")
    .where("customers.id", "=", parsed.customerId)
    .where("orders.current_status", "in", PRE_DEPOSIT_ORDER_STATUSES)
    .executeTakeFirst();
  if (!customer) {
    // The picked customer went stale between render and click — typically a
    // deposit was just recorded, or the remembered customer never had a
    // reusable consultation. Clearing the cookie stops a reload from
    // resurrecting the choice; the caller toasts the reason and falls back to
    // a brand-new consultation.
    cookieStore.delete(name);
    return {
      ok: false,
      error:
        "That customer is no longer awaiting a deposit and can't be reused for a consultation. Pick a booked lead or start a brand new customer.",
    };
  }

  cookieStore.set(name, customer.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
  return { ok: true };
}
