import "server-only";

import { db } from "@/lib/db/kysely";

export type MeshCategoryRow = {
  id: string;
  name: string;
  description: string | null;
  vendor_id: string | null;
  vendor_name: string | null;
  // Cents per ft². Null = not configured; a null sale means the category is
  // unpriced, a null cost means its margin is unreliable.
  cost_rmb_cents_per_sqft: number | null;
  sale_sgd_cents_per_sqft: number | null;
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
      "mesh_categories.cost_rmb_cents_per_sqft as cost_rmb_cents_per_sqft",
      "mesh_categories.sale_sgd_cents_per_sqft as sale_sgd_cents_per_sqft",
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

/**
 * Whether the consultation form may offer Mesh at all. Both halves matter:
 * without a priced category every quote is $0, and without an install cost
 * every quote overstates margin (the column defaults to 0). See spec §8.1 —
 * this is a setup gate meaning "an admin has configured mesh", not a business
 * rule that install always costs money.
 */
export async function meshIsSellable(): Promise<boolean> {
  const [priced, assumptions] = await Promise.all([
    db
      .selectFrom("mesh_categories")
      .select("id")
      .where("sale_sgd_cents_per_sqft", "is not", null)
      .where("is_active", "=", true)
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
