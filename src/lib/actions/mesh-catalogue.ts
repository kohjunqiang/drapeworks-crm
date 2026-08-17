"use server";

import "server-only";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth/require-role";
import { db } from "@/lib/db/kysely";
import { userMessage } from "@/lib/errors";
import { dollarsToCents } from "@/lib/money";
import {
  cmToMm,
  meshCategorySchema,
  meshColourSchema,
  meshMinimumCellSchema,
  meshSystemBandSchema,
  meshSystemSchema,
  sqmToCm2,
} from "@/lib/validation/mesh-catalogue";

const PATH = "/admin/product/mesh";

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

// ── system matrix ────────────────────────────────────────────────────────

// A blank system field means "not possible at this width", which is a real
// configuration and stored as null — the resolver reads null exactly that way.
export async function upsertMeshSystemBand(input: unknown) {
  const session = await requireRole(["admin"]);
  const parsed = meshSystemBandSchema.parse(input);

  const values = {
    max_width_cm: Number(parsed.max_width_cm),
    single_system: parsed.single_system || null,
    double_system: parsed.double_system || null,
  };

  try {
    if (parsed.isNew) {
      await db
        .insertInto("mesh_system_bands")
        .values({ ...values, created_by: session.user.id })
        .execute();
    } else {
      if (!parsed.id) throw new Error("Missing band id");
      await db
        .updateTable("mesh_system_bands")
        .set(values)
        .where("id", "=", parsed.id)
        .execute();
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // The partial unique index keeps resolution deterministic by allowing only
    // one active band per upper bound. Translate it into something actionable.
    if (/mesh_system_bands_max_width_unique/.test(msg)) {
      throw new Error(
        `A band already ends at ${values.max_width_cm} cm. Edit that one instead, or archive it first.`,
      );
    }
    if (err instanceof Error && /Missing band id/.test(err.message)) throw err;
    throw new Error(userMessage(err, "Could not save system band"));
  }

  revalidatePath(PATH);
}

export async function toggleMeshSystemBandActive(id: string) {
  await requireRole(["admin"]);
  await toggleActive("mesh_system_bands", id, "system band");
}

// ── track systems ────────────────────────────────────────────────────────

export async function upsertMeshSystem(input: unknown) {
  const session = await requireRole(["admin"]);
  const parsed = meshSystemSchema.parse(input);

  const values = {
    name: parsed.name,
    roller_mm: cmToMm(parsed.roller_cm),
    handle_mm: cmToMm(parsed.handle_cm),
    side_track_mm: cmToMm(parsed.side_track_cm),
    track_height_mm: cmToMm(parsed.track_height_cm),
    track_depth_mm: cmToMm(parsed.track_depth_cm),
    inset_deduction_mm: cmToMm(parsed.inset_deduction_cm),
    double_cost_rmb_cents: money(parsed.double_cost_rmb),
    double_sale_sgd_cents: money(parsed.double_sale_sgd),
  };

  try {
    if (parsed.isNew) {
      await db
        .insertInto("mesh_systems")
        .values({ ...values, created_by: session.user.id })
        .execute();
    } else {
      if (!parsed.id) throw new Error("Missing system id");
      await db
        .updateTable("mesh_systems")
        .set(values)
        .where("id", "=", parsed.id)
        .execute();
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/duplicate key|unique/i.test(msg)) {
      throw new Error(`System "${parsed.name}" already exists`);
    }
    if (err instanceof Error && /Missing system id/.test(err.message)) throw err;
    throw new Error(userMessage(err, "Could not save system"));
  }

  revalidatePath(PATH);
}

export async function toggleMeshSystemActive(id: string) {
  await requireRole(["admin"]);
  await toggleActive("mesh_systems", id, "system");
}

// ── minimum areas ────────────────────────────────────────────────────────

// One cell of the category × system grid. Upsert on the pair so an admin can
// fill cells in any order. A blank clears the minimum rather than storing zero
// — "no floor" and "a floor of nothing" should not be two states.
export async function upsertMeshMinimumArea(input: unknown) {
  await requireRole(["admin"]);
  const parsed = meshMinimumCellSchema.parse(input);
  const cm2 = sqmToCm2(parsed.min_sqm_per_leaf);

  try {
    if (cm2 == null) {
      await db
        .deleteFrom("mesh_minimum_areas")
        .where("category_id", "=", parsed.category_id)
        .where("system_id", "=", parsed.system_id)
        .execute();
    } else {
      await db
        .insertInto("mesh_minimum_areas")
        .values({
          category_id: parsed.category_id,
          system_id: parsed.system_id,
          min_area_cm2_per_leaf: cm2,
        })
        .onConflict((oc) =>
          oc
            .columns(["category_id", "system_id"])
            .doUpdateSet({ min_area_cm2_per_leaf: cm2 }),
        )
        .execute();
    }
  } catch (err) {
    throw new Error(userMessage(err, "Could not save minimum"));
  }

  revalidatePath(PATH);
}

// ── shared ───────────────────────────────────────────────────────────────

// Soft archive only — no hard deletes anywhere in this app. Archiving never
// breaks an existing order: price resolution reads by id regardless of
// is_active, and loadMeshCalcConfig unions in-use ids back into the form.
async function toggleActive(
  table:
    | "mesh_categories"
    | "mesh_colours"
    | "mesh_system_bands"
    | "mesh_systems",
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
    if (/mesh_system_bands_max_width_unique/.test(msg)) {
      throw new Error(
        "Another active band already ends at that width. Archive it before reactivating this one.",
      );
    }
    throw new Error(userMessage(err, `Could not update ${noun}`));
  }

  revalidatePath(PATH);
}
