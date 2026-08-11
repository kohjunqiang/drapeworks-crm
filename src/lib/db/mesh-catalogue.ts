import "server-only";

import { db } from "@/lib/db/kysely";

export type MeshCategoryRow = {
  id: string;
  name: string;
  description: string | null;
  vendor_id: string | null;
  vendor_name: string | null;
  position: number;
  is_active: boolean;
};

export type MeshColourRow = {
  id: string;
  name: string;
  surcharge_rmb_cents: number | null;
  surcharge_sgd_cents: number | null;
  position: number;
  is_active: boolean;
};

export type MeshSizeBandRow = {
  id: string;
  label: string;
  max_area_cm2: number | null;
  position: number;
  is_active: boolean;
};

export type MeshPriceRow = {
  category_id: string;
  band_id: string;
  cost_rmb_cents: number | null;
  sale_sgd_cents: number | null;
};

export async function loadMeshCategories(): Promise<MeshCategoryRow[]> {
  return db
    .selectFrom("mesh_categories")
    .leftJoin("vendors", "vendors.id", "mesh_categories.vendor_id")
    .select([
      "mesh_categories.id as id",
      "mesh_categories.name as name",
      "mesh_categories.description as description",
      "mesh_categories.vendor_id as vendor_id",
      "vendors.name as vendor_name",
      "mesh_categories.position as position",
      "mesh_categories.is_active as is_active",
    ])
    .orderBy("mesh_categories.position")
    .orderBy("mesh_categories.name")
    .execute();
}

export async function loadMeshColours(): Promise<MeshColourRow[]> {
  return db
    .selectFrom("mesh_colours")
    .select([
      "id",
      "name",
      "surcharge_rmb_cents",
      "surcharge_sgd_cents",
      "position",
      "is_active",
    ])
    .orderBy("position")
    .orderBy("name")
    .execute();
}

// Ordered by area, not by `position` — the same ordering the price lookup uses,
// so what an admin sees matches what the calculator does. The open-ended band
// (null threshold) sorts last.
export async function loadMeshSizeBands(): Promise<MeshSizeBandRow[]> {
  const rows = await db
    .selectFrom("mesh_size_bands")
    .select(["id", "label", "max_area_cm2", "position", "is_active"])
    .execute();

  return rows.sort((a, b) => {
    if (a.max_area_cm2 == null) return b.max_area_cm2 == null ? 0 : 1;
    if (b.max_area_cm2 == null) return -1;
    return a.max_area_cm2 - b.max_area_cm2;
  });
}

export async function loadMeshPrices(): Promise<MeshPriceRow[]> {
  return db
    .selectFrom("mesh_prices")
    .select(["category_id", "band_id", "cost_rmb_cents", "sale_sgd_cents"])
    .execute();
}

/**
 * Whether the consultation form may offer Mesh at all. Both halves matter:
 * without a priced cell every quote is $0, and without an install cost every
 * quote overstates margin (the column defaults to 0). See spec §8.1 — this is a
 * setup gate meaning "an admin has configured mesh", not a business rule that
 * install always costs money.
 */
export async function meshIsSellable(): Promise<boolean> {
  const [priced, assumptions] = await Promise.all([
    db
      .selectFrom("mesh_prices")
      .select("id")
      .where("sale_sgd_cents", "is not", null)
      .limit(1)
      .executeTakeFirst(),
    db
      .selectFrom("pricing_assumptions")
      .select("handyman_mesh_sgd_cents")
      .where("singleton", "=", true)
      .executeTakeFirst(),
  ]);

  return !!priced && (assumptions?.handyman_mesh_sgd_cents ?? 0) > 0;
}
