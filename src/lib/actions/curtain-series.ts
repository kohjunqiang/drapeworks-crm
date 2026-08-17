"use server";

import "server-only";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth/require-role";
import { db } from "@/lib/db/kysely";
import { userMessage } from "@/lib/errors";
import { dollarsToCents } from "@/lib/money";
import { curtainSeriesSchema } from "@/lib/validation/curtain-series";

function revalidateCatalogue() {
  revalidatePath("/admin/product/curtains");
  revalidatePath("/admin/product/blinds");
  revalidatePath("/orders/new");
}

export async function upsertCurtainSeries(input: unknown) {
  const session = await requireRole(["admin"]);
  const parsed = curtainSeriesSchema.parse(input);

  // Pricing lives on the series — convert the decimal inputs to integer cents.
  const pricing = {
    vendor_id:
      parsed.vendor_id && parsed.vendor_id !== "" ? parsed.vendor_id : null,
    cost_rmb_cents:
      parsed.cost_rmb && parsed.cost_rmb !== ""
        ? dollarsToCents(parsed.cost_rmb)
        : null,
    sale_sgd_cents:
      parsed.sale_sgd && parsed.sale_sgd !== ""
        ? dollarsToCents(parsed.sale_sgd)
        : null,
    calc_method: parsed.calc_method,
  };

  try {
    if (parsed.isNew) {
      // product_line is set ONCE, from the catalogue tab this series was
      // created on. It is deliberately absent from the update branch below:
      // moving a series between lines would change how every window
      // referencing it is priced and installed, silently and retroactively.
      await db
        .insertInto("curtain_series")
        .values({
          name: parsed.name,
          created_by: session.user.id,
          product_line: parsed.product_line,
          ...pricing,
        })
        .execute();
    } else {
      if (!parsed.id) throw new Error("Missing series id");
      await db
        .updateTable("curtain_series")
        .set({ name: parsed.name, ...pricing })
        .where("id", "=", parsed.id)
        .execute();
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/duplicate key|unique/i.test(msg)) {
      throw new Error(`Series "${parsed.name}" already exists`);
    }
    if (err instanceof Error && /Missing series id/.test(err.message)) throw err;
    throw new Error(userMessage(err, "Could not save series"));
  }

  revalidateCatalogue();
}

export async function toggleCurtainSeriesActive(id: string) {
  await requireRole(["admin"]);
  if (typeof id !== "string" || id.length === 0) {
    throw new Error("Invalid series id");
  }

  const current = await db
    .selectFrom("curtain_series")
    .select("is_active")
    .where("id", "=", id)
    .executeTakeFirst();
  if (!current) throw new Error("Series not found");

  // Soft archive — no hard deletes. Archived series drop out of the assignment
  // dropdown; existing curtain types keep their reference.
  try {
    await db
      .updateTable("curtain_series")
      .set({ is_active: !current.is_active })
      .where("id", "=", id)
      .execute();
  } catch (err) {
    throw new Error(userMessage(err, "Could not update series"));
  }

  revalidateCatalogue();
}
