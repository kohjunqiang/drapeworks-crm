import "server-only";

import { sql } from "kysely";

import { db } from "@/lib/db/kysely";
import { nextPoNumber } from "./number";

/** Atomically assign the next running number, or return the one already saved. */
export async function ensurePoNumber(orderId: string): Promise<string> {
  return db.transaction().execute(async (trx) => {
    // Serialise automatic assignments so two orders opened together cannot be
    // given the same running number.
    await sql`select pg_advisory_xact_lock(10052)`.execute(trx);

    const order = await trx
      .selectFrom("orders")
      .select("order_reference")
      .where("id", "=", orderId)
      .executeTakeFirst();
    if (!order) throw new Error("Order not found");
    if (order.order_reference) return order.order_reference;

    const existing = await trx
      .selectFrom("orders")
      .select("order_reference")
      .where("order_reference", "is not", null)
      .execute();
    const assigned = nextPoNumber(existing.map((row) => row.order_reference));

    await trx
      .updateTable("orders")
      .set({ order_reference: assigned })
      .where("id", "=", orderId)
      .where("order_reference", "is", null)
      .execute();
    return assigned;
  });
}
