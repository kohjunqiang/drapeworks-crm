import "server-only";

import { db } from "@/lib/db/kysely";
import type {
  MeshSystemBand,
  MeshSystemSpec,
} from "@/lib/orders/mesh-system";

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

export type MeshSystemRow = {
  id: string;
  name: string;
  roller_mm: number;
  handle_mm: number;
  side_track_mm: number;
  track_height_mm: number;
  track_depth_mm: number;
  inset_deduction_mm: number;
  double_cost_rmb_cents: number | null;
  double_sale_sgd_cents: number | null;
  position: number;
  is_active: boolean;
};

export async function loadMeshSystems(): Promise<MeshSystemRow[]> {
  return db
    .selectFrom("mesh_systems")
    .select([
      "id",
      "name",
      "roller_mm",
      "handle_mm",
      "side_track_mm",
      "track_height_mm",
      "track_depth_mm",
      "inset_deduction_mm",
      "double_cost_rmb_cents",
      "double_sale_sgd_cents",
      "position",
      "is_active",
    ])
    .orderBy("position")
    .orderBy("name")
    .execute();
}

// The active specs in the shape the track calculation wants. Active only: an
// archived system must not keep sizing new tracks.
export async function loadActiveMeshSystemSpecs(): Promise<MeshSystemSpec[]> {
  const rows = await db
    .selectFrom("mesh_systems")
    .select([
      "name",
      "roller_mm",
      "handle_mm",
      "side_track_mm",
      "track_height_mm",
      "inset_deduction_mm",
    ])
    .where("is_active", "=", true)
    .execute();

  return rows.map((r) => ({
    name: r.name,
    rollerMm: r.roller_mm,
    handleMm: r.handle_mm,
    sideTrackMm: r.side_track_mm,
    trackHeightMm: r.track_height_mm,
    insetDeductionMm: r.inset_deduction_mm,
  }));
}

export type MeshSystemBandRow = {
  id: string;
  max_width_cm: number;
  single_system: string | null;
  double_system: string | null;
  position: number;
  is_active: boolean;
};

// Ordered by width, the same ordering resolution uses, so what an admin sees
// matches what gets built.
export async function loadMeshSystemBands(): Promise<MeshSystemBandRow[]> {
  return db
    .selectFrom("mesh_system_bands")
    .select([
      "id",
      "max_width_cm",
      "single_system",
      "double_system",
      "position",
      "is_active",
    ])
    .orderBy("max_width_cm")
    .execute();
}

// The active matrix in the shape the resolver wants: plain serialisable
// objects, so the same value crosses to the consultation form as a prop and is
// used directly by the server actions. Active only — an archived band must not
// keep deciding what gets built.
export async function loadActiveMeshSystemBands(): Promise<MeshSystemBand[]> {
  const rows = await db
    .selectFrom("mesh_system_bands")
    .select(["max_width_cm", "single_system", "double_system"])
    .where("is_active", "=", true)
    .execute();

  return rows.map((r) => ({
    maxWidthCm: r.max_width_cm,
    singleSystem: r.single_system,
    doubleSystem: r.double_system,
  }));
}

export type MeshMinimumRow = {
  category_id: string;
  system_id: string;
  min_area_cm2_per_leaf: number;
};

export async function loadMeshMinimumAreas(): Promise<MeshMinimumRow[]> {
  return db
    .selectFrom("mesh_minimum_areas")
    .select(["category_id", "system_id", "min_area_cm2_per_leaf"])
    .execute();
}

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
