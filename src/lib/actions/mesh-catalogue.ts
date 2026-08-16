"use server";

import "server-only";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth/require-role";
import { db } from "@/lib/db/kysely";
import { userMessage } from "@/lib/errors";
import { dollarsToCents } from "@/lib/money";
import {
  meshCategorySchema,
  meshColourSchema,
} from "@/lib/validation/mesh-catalogue";

const PATH = "/admin/mesh";

const money = (v: string | undefined): number | null =>
  v && v !== "" ? dollarsToCents(v) : null;

// ── categories ───────────────────────────────────────────────────────────

export async function upsertMeshCategory(input: unknown) {
  const session = await requireRole(["admin"]);
  const parsed = meshCategorySchema.parse(input);

  const values = {
    name: parsed.name,
    description: parsed.description || null,
    vendor_id: parsed.vendor_id || null,
    // Cents per ft². The whole of mesh pricing is these two numbers × area.
    cost_rmb_cents_per_sqft: money(parsed.cost_rmb_per_sqft),
    sale_sgd_cents_per_sqft: money(parsed.sale_sgd_per_sqft),
  };

  try {
    if (parsed.isNew) {
      await db
        .insertInto("mesh_categories")
        .values({ ...values, created_by: session.user.id })
        .execute();
    } else {
      if (!parsed.id) throw new Error("Missing category id");
      await db
        .updateTable("mesh_categories")
        .set(values)
        .where("id", "=", parsed.id)
        .execute();
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/duplicate key|unique/i.test(msg)) {
      throw new Error(`Category "${parsed.name}" already exists`);
    }
    if (err instanceof Error && /Missing category id/.test(err.message))
      throw err;
    throw new Error(userMessage(err, "Could not save category"));
  }

  revalidatePath(PATH);
}

export async function toggleMeshCategoryActive(id: string) {
  await requireRole(["admin"]);
  await toggleActive("mesh_categories", id, "category");
}

// ── colours ──────────────────────────────────────────────────────────────

export async function upsertMeshColour(input: unknown) {
  const session = await requireRole(["admin"]);
  const parsed = meshColourSchema.parse(input);

  const values = {
    name: parsed.name,
    surcharge_rmb_cents: money(parsed.surcharge_rmb),
    surcharge_sgd_cents: money(parsed.surcharge_sgd),
  };

  try {
    if (parsed.isNew) {
      await db
        .insertInto("mesh_colours")
        .values({ ...values, created_by: session.user.id })
        .execute();
    } else {
      if (!parsed.id) throw new Error("Missing colour id");
      await db
        .updateTable("mesh_colours")
        .set(values)
        .where("id", "=", parsed.id)
        .execute();
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/duplicate key|unique/i.test(msg)) {
      throw new Error(`Colour "${parsed.name}" already exists`);
    }
    if (err instanceof Error && /Missing colour id/.test(err.message))
      throw err;
    throw new Error(userMessage(err, "Could not save colour"));
  }

  revalidatePath(PATH);
}

export async function toggleMeshColourActive(id: string) {
  await requireRole(["admin"]);
  await toggleActive("mesh_colours", id, "colour");
}

// ── shared ───────────────────────────────────────────────────────────────

// Soft archive only — no hard deletes anywhere in this app. Archiving never
// breaks an existing order: price resolution reads by id regardless of
// is_active, and loadMeshCalcConfig unions in-use ids back into the form.
async function toggleActive(
  table: "mesh_categories" | "mesh_colours",
  id: string,
  noun: string,
) {
  if (typeof id !== "string" || id.length === 0) {
    throw new Error(`Invalid ${noun} id`);
  }

  const current = await db
    .selectFrom(table)
    .select("is_active")
    .where("id", "=", id)
    .executeTakeFirst();
  if (!current) throw new Error(`Mesh ${noun} not found`);

  try {
    await db
      .updateTable(table)
      .set({ is_active: !current.is_active })
      .where("id", "=", id)
      .execute();
  } catch (err) {
    throw new Error(userMessage(err, `Could not update ${noun}`));
  }

  revalidatePath(PATH);
}
