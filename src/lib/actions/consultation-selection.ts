"use server";

import { cookies } from "next/headers";
import { z } from "zod";

import { requireRole } from "@/lib/auth/require-role";
import { db } from "@/lib/db/kysely";
import { consultationCustomerCookie } from "@/lib/orders/consultation-selection";

const selectionSchema = z.object({
  product: z.enum(["curtain", "mesh"]),
  customerId: z.string().uuid().nullable(),
});

/** Keep a returning-customer choice in the browser session, not in the URL. */
export async function setConsultationCustomer(input: unknown): Promise<void> {
  await requireRole(["consultant", "admin"]);
  const parsed = selectionSchema.parse(input);
  const cookieStore = await cookies();
  const name = consultationCustomerCookie(parsed.product);

  if (!parsed.customerId) {
    cookieStore.delete(name);
    return;
  }

  const customer = await db
    .selectFrom("customers")
    .innerJoin("orders", "orders.customer_id", "customers.id")
    .select("customers.id")
    .where("customers.id", "=", parsed.customerId)
    .executeTakeFirst();
  if (!customer) throw new Error("Customer record not found");

  cookieStore.set(name, customer.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
}
