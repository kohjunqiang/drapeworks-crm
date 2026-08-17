import {
  CurtainTypesTable,
  type CurtainTypeRow,
} from "@/components/curtain-types/curtain-types-table";
import type { CurtainProductLine } from "@/lib/db/schema";
import {
  loadSeriesForCatalogue,
  signCurtainTypePhotoUrls,
} from "@/lib/db/curtain-types";
import { loadActiveVendorOptions } from "@/lib/db/vendors";
import { db } from "@/lib/db/kysely";
import { centsToDisplay } from "@/lib/money";

// The Curtains and Blinds tabs are the SAME catalogue over the same tables,
// filtered by the series' product line. Sharing one loader is what keeps them
// honest: a column added for curtains shows up for blinds, and neither tab can
// drift into its own half-maintained copy of this query.
//
// Only the copy and the Day/Night category column differ, and both of those are
// decided inside CurtainTypesTable from the same productLine prop.

const COPY = {
  curtain: {
    title: "Curtains",
    blurb: "The photo-backed curtain types consultants pick from",
  },
  blind: {
    title: "Blinds",
    blurb:
      "Blinds are organised by series — the series name carries the family (Zebra, Roller, Roman)",
  },
} as const;

export async function CataloguePage({
  productLine,
}: {
  productLine: CurtainProductLine;
}) {
  const [rows, series, vendors] = await Promise.all([
    db
      .selectFrom("curtain_types")
      // innerJoin, not left: the product line lives on the series, so a type
      // without one has no tab to belong to. Safe because curtainTypeSchema
      // requires series_id — the column is nullable only for historical
      // reasons, and there are no such rows.
      .innerJoin("curtain_series", "curtain_series.id", "curtain_types.series_id")
      // Pricing is inherited from the series' chosen vendor.
      .leftJoin("vendors", "vendors.id", "curtain_series.vendor_id")
      .select([
        "curtain_types.id as id",
        "curtain_types.label as label",
        "curtain_types.category as category",
        "curtain_types.status as status",
        "curtain_types.photo_path as photo_path",
        "curtain_types.series_id as series_id",
        "curtain_types.series_index as series_index",
        "curtain_types.page as page",
        "curtain_series.name as series_name",
        "curtain_series.cost_rmb_cents as cost_rmb_cents",
        "curtain_series.sale_sgd_cents as sale_sgd_cents",
        "vendors.name as vendor_name",
      ])
      .where("curtain_series.product_line", "=", productLine)
      .orderBy("curtain_series.name", "asc")
      .orderBy("curtain_types.series_index", "asc")
      .orderBy("curtain_types.label", "asc")
      .execute(),
    loadSeriesForCatalogue(productLine),
    loadActiveVendorOptions(),
  ]);

  const paths = rows.map((r) => r.photo_path).filter((p): p is string => !!p);
  const urls = await signCurtainTypePhotoUrls(paths);

  const curtainTypes: CurtainTypeRow[] = rows.map((r) => ({
    id: r.id,
    label: r.label,
    category: r.category,
    status: r.status,
    photo_path: r.photo_path,
    photoUrl: r.photo_path ? (urls.get(r.photo_path) ?? null) : null,
    series_id: r.series_id,
    series_name: r.series_name,
    series_index: r.series_index,
    page: r.page,
    // Inherited from the series (read-only here).
    vendor_name: r.vendor_name,
    cost_rmb: r.cost_rmb_cents != null ? centsToDisplay(r.cost_rmb_cents) : null,
    sale_sgd: r.sale_sgd_cents != null ? centsToDisplay(r.sale_sgd_cents) : null,
  }));

  const copy = COPY[productLine];

  return (
    <>
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-slate-900">{copy.title}</h2>
        <p className="text-sm text-slate-500 mt-1">{copy.blurb}</p>
      </div>
      <CurtainTypesTable
        curtainTypes={curtainTypes}
        series={series}
        vendors={vendors}
        productLine={productLine}
      />
    </>
  );
}
