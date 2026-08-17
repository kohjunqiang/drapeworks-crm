"use server";

import "server-only";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth/require-role";
import { db } from "@/lib/db/kysely";
import { userMessage } from "@/lib/errors";
import { allowanceSchema } from "@/lib/validation/manufacture";

export async function saveManufactureAllowance(input: unknown): Promise<void> {
  const session = await requireRole(["admin"]);
  const parsed = allowanceSchema.parse(input);

  try {
    // updated_at is stamped by the manufacture_allowances_set_updated_at
    // trigger, so it is deliberately absent here.
    await db
      .updateTable("manufacture_allowances")
      .set({
        width_delta_cm: parsed.widthDeltaCm,
        height_delta_cm: parsed.heightDeltaCm,
        updated_by: session.user.id,
      })
      .where("product_line", "=", parsed.productLine)
      .execute();
  } catch (e) {
    throw new Error(userMessage(e, "Could not save the allowance."));
  }

  revalidatePath("/admin/product/allowances");
}
