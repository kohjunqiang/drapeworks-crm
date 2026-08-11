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
  meshPriceCellSchema,
  meshSizeBandSchema,
  sqmToCm2,
} from "@/lib/validation/mesh-catalogue";

const PATH = "/admin/mesh";

const money = (v: string | undefined): number | null =>
  v && v !== "" ? dollarsToCents(v) : null;

// ── categories ───────────────────────────────────────────────────────────

export async function upsertMeshCategory(input: unknown) {
  const session = await requireRole(["admin"]);
  const parsed = meshCategorySchema.parse(input);

  try {
    if (parsed.isNew) {
      await db
        .insertInto("mesh_categories")
        .values({
          name: parsed.name,
          description: parsed.description || null,
          vendor_id: parsed.vendor_id || null,
          created_by: session.user.id,
        })
        .execute();
    } else {
      if (!parsed.id) throw new Error("Missing category id");
      await db
        .updateTable("mesh_categories")
        .set({
          name: parsed.name,
          description: parsed.description || null,
          vendor_id: parsed.vendor_id || null,
        })
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

// ── size bands ───────────────────────────────────────────────────────────

export async function upsertMeshSizeBand(input: unknown) {
  const session = await requireRole(["admin"]);
  const parsed = meshSizeBandSchema.parse(input);

  const values = {
    label: parsed.label,
    max_area_cm2: sqmToCm2(parsed.max_area_sqm),
  };

  try {
    if (parsed.isNew) {
      await db
        .insertInto("mesh_size_bands")
        .values({ ...values, created_by: session.user.id })
        .execute();
    } else {
      if (!parsed.id) throw new Error("Missing band id");
      await db
        .updateTable("mesh_size_bands")
        .set(values)
        .where("id", "=", parsed.id)
        .execute();
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // The partial unique index guarantees at most one ACTIVE open-ended band.
    // Translate its raw violation into something an admin can act on.
    if (/mesh_size_bands_single_open_band/.test(msg)) {
      throw new Error(
        "There is already an open-ended band. Archive it first, or give this one an area limit.",
      );
    }
    if (err instanceof Error && /Missing band id/.test(err.message)) throw err;
    throw new Error(userMessage(err, "Could not save size band"));
  }

  revalidatePath(PATH);
}

export async function toggleMeshSizeBandActive(id: string) {
  await requireRole(["admin"]);
  await toggleActive("mesh_size_bands", id, "size band");
}

// ── price grid ───────────────────────────────────────────────────────────

// One cell of the category × band grid. Upsert on the unique pair so the admin
// can fill cells in any order without first "creating" a row.
export async function upsertMeshPrice(input: unknown) {
  await requireRole(["admin"]);
  const parsed = meshPriceCellSchema.parse(input);

  try {
    await db
      .insertInto("mesh_prices")
      .values({
        category_id: parsed.category_id,
        band_id: parsed.band_id,
        cost_rmb_cents: money(parsed.cost_rmb),
        sale_sgd_cents: money(parsed.sale_sgd),
      })
      .onConflict((oc) =>
        oc.columns(["category_id", "band_id"]).doUpdateSet({
          cost_rmb_cents: money(parsed.cost_rmb),
          sale_sgd_cents: money(parsed.sale_sgd),
        }),
      )
      .execute();
  } catch (err) {
    throw new Error(userMessage(err, "Could not save price"));
  }

  revalidatePath(PATH);
}

// ── shared ───────────────────────────────────────────────────────────────

// Soft archive only — no hard deletes anywhere in this app. Archiving never
// breaks an existing order: price resolution reads by id regardless of
// is_active, and loadMeshCalcConfig unions in-use ids back into the form.
async function toggleActive(
  table: "mesh_categories" | "mesh_colours" | "mesh_size_bands",
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
    const msg = err instanceof Error ? err.message : String(err);
    if (/mesh_size_bands_single_open_band/.test(msg)) {
      throw new Error(
        "Another open-ended band is already active. Archive it before reactivating this one.",
      );
    }
    throw new Error(userMessage(err, `Could not update ${noun}`));
  }

  revalidatePath(PATH);
}
