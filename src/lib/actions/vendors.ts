"use server";

import "server-only";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth/require-role";
import { db } from "@/lib/db/kysely";
import { userMessage } from "@/lib/errors";
import { vendorProcurementFieldsSchema } from "@/lib/validation/procurement";
import { vendorSchema } from "@/lib/validation/vendor";

function revalidateVendors() {
  revalidatePath("/admin/vendors");
}

export async function upsertVendor(input: unknown) {
  const session = await requireRole(["admin"]);
  const parsed = vendorSchema.parse(input);
  const notes = parsed.notes && parsed.notes.length > 0 ? parsed.notes : null;
  // A blank PO field must land as NULL, not "": the PO omits a null line and
  // prints an empty one for "", which on a factory document reads as an
  // omission somebody then fills in by guessing.
  const po = vendorProcurementFieldsSchema.parse(parsed);

  try {
    if (parsed.isNew) {
      await db
        .insertInto("vendors")
        .values({
          name: parsed.name,
          notes,
          ...po,
          created_by: session.user.id,
        })
        .execute();
    } else {
      if (!parsed.id) throw new Error("Missing vendor id");
      await db
        .updateTable("vendors")
        .set({ name: parsed.name, notes, ...po })
        .where("id", "=", parsed.id)
        .execute();
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/duplicate key|unique/i.test(msg)) {
      throw new Error(`Vendor "${parsed.name}" already exists`);
    }
    if (err instanceof Error && /Missing vendor id/.test(err.message)) throw err;
    throw new Error(userMessage(err, "Could not save vendor"));
  }

  revalidateVendors();
}

export async function toggleVendorActive(id: string) {
  await requireRole(["admin"]);
  if (typeof id !== "string" || id.length === 0) {
    throw new Error("Invalid vendor id");
  }

  const current = await db
    .selectFrom("vendors")
    .select("is_active")
    .where("id", "=", id)
    .executeTakeFirst();
  if (!current) throw new Error("Vendor not found");

  // Soft archive — no hard deletes. Archived vendors drop out of the pricing
  // picker; curtain types keep any existing reference.
  try {
    await db
      .updateTable("vendors")
      .set({ is_active: !current.is_active })
      .where("id", "=", id)
      .execute();
  } catch (err) {
    throw new Error(userMessage(err, "Could not update vendor"));
  }

  revalidateVendors();
}
