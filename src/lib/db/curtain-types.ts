import "server-only";

import { cache } from "react";

import { formatCurtainOptionLabel } from "@/lib/curtain-types/series";
import type { CurtainCategory, CurtainProductLine } from "@/lib/db/schema";
import { db } from "@/lib/db/kysely";
import { centsToDisplay } from "@/lib/money";
import { adminClient } from "@/lib/supabase/admin";
import { CURTAIN_TYPE_PHOTO_BUCKET } from "@/lib/storage/curtain-type-photo";

// Curtain-type photos change rarely, so we sign them with a long TTL and reuse
// the SAME url across requests. A rotating token on every render would bust the
// browser/`next/image` cache and force a re-download of every thumbnail on each
// page load. TTL is 7 days; we re-sign a path once it has < 1 day of validity
// left, so a served url is always still valid.
const TTL_SECONDS = 7 * 24 * 60 * 60;
const REFRESH_BEFORE_MS = 24 * 60 * 60 * 1000;

// Process-wide, per-path cache of signed urls. Safe as a server singleton: the
// urls are bucket-level (not user-specific) and there are only ~150 paths. On a
// long-running server (Railway standalone) this persists across requests; a
// fresh instance simply re-signs on first use.
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();

// Batched signed read URLs for curtain-type hero photos. The outer React
// cache() dedupes within one render; the module cache above makes the urls
// stable across requests so they stay cacheable client-side. Mirrors
// signRoomPhotoUrls.
export const signCurtainTypePhotoUrls = cache(
  async (paths: string[]): Promise<Map<string, string>> => {
    if (paths.length === 0) return new Map();
    const now = Date.now();
    const stale = paths.filter((p) => {
      const hit = signedUrlCache.get(p);
      return !hit || hit.expiresAt - now < REFRESH_BEFORE_MS;
    });
    if (stale.length > 0) {
      const admin = adminClient();
      const { data, error } = await admin.storage
        .from(CURTAIN_TYPE_PHOTO_BUCKET)
        .createSignedUrls(stale, TTL_SECONDS);
      if (error) throw new Error(error.message);
      for (const row of data) {
        if (row.path && row.signedUrl) {
          signedUrlCache.set(row.path, {
            url: row.signedUrl,
            expiresAt: now + TTL_SECONDS * 1000,
          });
        }
      }
    }
    const out = new Map<string, string>();
    for (const p of paths) {
      const hit = signedUrlCache.get(p);
      if (hit) out.set(p, hit.url);
    }
    return out;
  },
);

export type CurtainTypeOptionRow = {
  id: string;
  label: string; // formatted: "Series #index · Page — Label"
  // Null for a blind: Day/Night is a curtain sheerness taxonomy and means
  // nothing for a blind, which is identified by its series' product line.
  category: CurtainCategory | null;
  // Which line the option belongs to. Consumers MUST filter on this — the
  // day/night selects take 'curtain' only, the blind select takes 'blind'
  // only. A leftJoin can yield null for a type with no series; treated as a
  // curtain, which is what such a row has always been.
  productLine: CurtainProductLine;
  photoUrl: string | null;
  // Series pricing, so the live quote can price a selection client-side.
  costRmbCents: number | null;
  saleSgdCents: number | null;
  // The series name on its own ("Essential"), so the live quote's cost
  // breakdown can name what the goods are. `label` above has it baked into a
  // longer display string and can't be split back out reliably.
  seriesName: string | null;
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
      "curtain_series.cost_rmb_cents as cost_rmb_cents",
      "curtain_series.sale_sgd_cents as sale_sgd_cents",
      "curtain_series.product_line as product_line",
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
    productLine: r.product_line ?? "curtain",
    photoUrl: r.photo_path ? (urls.get(r.photo_path) ?? null) : null,
    costRmbCents: r.cost_rmb_cents,
    saleSgdCents: r.sale_sgd_cents,
    seriesName: r.series_name,
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
export async function loadSeriesForCatalogue(
  productLine: CurtainProductLine = "curtain",
): Promise<CurtainSeriesRow[]> {
  const rows = await db
    .selectFrom("curtain_series")
    .where("curtain_series.product_line", "=", productLine)
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
