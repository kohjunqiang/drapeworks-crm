import "server-only";

import { cache } from "react";

import { formatCurtainOptionLabel } from "@/lib/curtain-types/series";
import { db } from "@/lib/db/kysely";
import { centsToDisplay } from "@/lib/money";
import { adminClient } from "@/lib/supabase/admin";
import { CURTAIN_TYPE_PHOTO_BUCKET } from "@/lib/storage/curtain-type-photo";

const TTL_SECONDS = 3600;

// Batched signed read URLs for curtain-type hero photos, wrapped in React
// cache() so repeated renders in one request reuse the same signing call.
// Mirrors signRoomPhotoUrls.
export const signCurtainTypePhotoUrls = cache(
  async (paths: string[]): Promise<Map<string, string>> => {
    if (paths.length === 0) return new Map();
    const admin = adminClient();
    const { data, error } = await admin.storage
      .from(CURTAIN_TYPE_PHOTO_BUCKET)
      .createSignedUrls(paths, TTL_SECONDS);
    if (error) throw new Error(error.message);
    const out = new Map<string, string>();
    for (const row of data) {
      if (row.path && row.signedUrl) out.set(row.path, row.signedUrl);
    }
    return out;
  },
);

export type CurtainTypeOptionRow = {
  id: string;
  label: string; // formatted: "Series #index · Page — Label"
  category: "Day" | "Night";
  photoUrl: string | null;
};

// Active curtain types for the consultation form's pickers, with signed hero
// photo URLs and the series/index/page baked into the display label. Shared by
// the new + edit order pages.
export async function loadActiveCurtainTypeOptions(): Promise<
  CurtainTypeOptionRow[]
> {
  const rows = await db
    .selectFrom("curtain_types")
    .leftJoin("curtain_series", "curtain_series.id", "curtain_types.series_id")
    .select([
      "curtain_types.id as id",
      "curtain_types.label as label",
      "curtain_types.category as category",
      "curtain_types.photo_path as photo_path",
      "curtain_types.series_index as series_index",
      "curtain_types.page as page",
      "curtain_series.name as series_name",
    ])
    .where("curtain_types.status", "=", "Active")
    .orderBy("curtain_series.name", "asc")
    .orderBy("curtain_types.series_index", "asc")
    .orderBy("curtain_types.label", "asc")
    .execute();

  const urls = await signCurtainTypePhotoUrls(
    rows.map((r) => r.photo_path).filter((p): p is string => !!p),
  );

  return rows.map((r) => ({
    id: r.id,
    label: formatCurtainOptionLabel({
      series: r.series_name,
      index: r.series_index,
      page: r.page,
      label: r.label,
    }),
    category: r.category,
    photoUrl: r.photo_path ? (urls.get(r.photo_path) ?? null) : null,
  }));
}

export type CurtainSeriesRow = {
  id: string;
  name: string;
  is_active: boolean;
  typeCount: number;
  // Pricing (Phase 9) — inherited by every curtain type in the series.
  vendor_id: string | null;
  vendor_name: string | null;
  cost_rmb: string | null; // decimal string for the edit form
  sale_sgd: string | null;
};

// All series (active + archived) with how many curtain types reference each,
// plus the series' pricing + chosen vendor name, for the admin management
// dialog. The form assignment dropdown filters to the active ones.
export async function loadSeriesForCatalogue(): Promise<CurtainSeriesRow[]> {
  const rows = await db
    .selectFrom("curtain_series")
    .leftJoin("curtain_types", "curtain_types.series_id", "curtain_series.id")
    .leftJoin("vendors", "vendors.id", "curtain_series.vendor_id")
    .select((eb) => [
      "curtain_series.id as id",
      "curtain_series.name as name",
      "curtain_series.is_active as is_active",
      "curtain_series.vendor_id as vendor_id",
      "curtain_series.cost_rmb_cents as cost_rmb_cents",
      "curtain_series.sale_sgd_cents as sale_sgd_cents",
      "vendors.name as vendor_name",
      eb.fn.count("curtain_types.id").as("type_count"),
    ])
    .groupBy([
      "curtain_series.id",
      "curtain_series.name",
      "curtain_series.is_active",
      "curtain_series.vendor_id",
      "curtain_series.cost_rmb_cents",
      "curtain_series.sale_sgd_cents",
      "vendors.name",
    ])
    .orderBy("curtain_series.name", "asc")
    .execute();

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    is_active: r.is_active,
    typeCount: Number(r.type_count),
    vendor_id: r.vendor_id,
    vendor_name: r.vendor_name,
    cost_rmb: r.cost_rmb_cents != null ? centsToDisplay(r.cost_rmb_cents) : null,
    sale_sgd: r.sale_sgd_cents != null ? centsToDisplay(r.sale_sgd_cents) : null,
  }));
}
