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
    const result = await db
      .updateTable("manufacture_allowances")
      .set({
        width_delta_cm: parsed.widthDeltaCm,
        height_delta_cm: parsed.heightDeltaCm,
        updated_by: session.user.id,
      })
      .where("product_line", "=", parsed.productLine)
      .execute();

    // The three rows are seeded by the migration and there is no insert or
    // delete policy, so a zero-row update is unreachable today. It only stays
    // unreachable while the Zod enum, the CHECK constraint and the seed agree;
    // if they ever drift, the failure mode without this is a silent no-op
    // behind a success toast, which is the worst kind to track down.
    // Number(), not a bigint literal: this project's tsconfig target predates
    // ES2020 and 0n does not compile.
    if (Number(result[0]?.numUpdatedRows ?? 0) === 0) {
      throw new Error(
        `No allowance row exists for "${parsed.productLine}". The catalogue and the database disagree — tell an admin.`,
      );
    }
  } catch (e) {
    throw new Error(userMessage(e, "Could not save the allowance."));
  }

  revalidatePath("/admin/product/allowances");
}
