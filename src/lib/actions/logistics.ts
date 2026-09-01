"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth/require-role";
import { db } from "@/lib/db/kysely";
import { statusIndex } from "@/lib/status-flow";

const optionalNumber = z.string().max(200).transform((value) => value.trim() || null);
const schema = z.object({
  orderId: z.string().uuid(),
  goodsOverseas: optionalNumber,
  goodsLocal: optionalNumber,
  trackOverseas: optionalNumber,
  trackLocal: optionalNumber,
});

export async function saveDeliveryNumbers(input: unknown): Promise<void> {
  await requireRole(["ops", "admin"]);
  const parsed = schema.parse(input);
  const order = await db.selectFrom("orders").select("current_status")
    .where("id", "=", parsed.orderId).executeTakeFirst();
  if (!order) throw new Error("Order not found");
  if (statusIndex(order.current_status) < statusIndex("sent_to_vendor")) {
    throw new Error("Delivery numbers can be recorded after the order is sent to the vendor.");
  }
  await db.updateTable("orders").set({
    goods_overseas_tracking_number: parsed.goodsOverseas,
    goods_local_delivery_number: parsed.goodsLocal,
    track_overseas_tracking_number: parsed.trackOverseas,
    track_local_delivery_number: parsed.trackLocal,
  }).where("id", "=", parsed.orderId).execute();
  revalidatePath(`/orders/${parsed.orderId}`);
}
