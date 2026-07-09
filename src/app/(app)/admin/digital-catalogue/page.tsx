import {
  CurtainTypesTable,
  type CurtainTypeRow,
} from "@/components/curtain-types/curtain-types-table";
import { requireRole } from "@/lib/auth/require-role";
import {
  loadSeriesForCatalogue,
  signCurtainTypePhotoUrls,
} from "@/lib/db/curtain-types";
import { db } from "@/lib/db/kysely";

export const dynamic = "force-dynamic";

export const metadata = { title: "Digital Catalogue — Drapeworks CRM" };

export default async function DigitalCataloguePage() {
  // Admin-only management screen.
  await requireRole(["admin"]);

  const [rows, series] = await Promise.all([
    db
      .selectFrom("curtain_types")
      .leftJoin("curtain_series", "curtain_series.id", "curtain_types.series_id")
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
      ])
      .orderBy("curtain_series.name", "asc")
      .orderBy("curtain_types.series_index", "asc")
      .orderBy("curtain_types.label", "asc")
      .execute(),
    loadSeriesForCatalogue(),
  ]);

  const paths = rows
    .map((r) => r.photo_path)
    .filter((p): p is string => !!p);
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
  }));

  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
            Digital Catalogue
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Manage the photo-backed curtain types consultants pick from
          </p>
        </div>
      </div>
      <CurtainTypesTable curtainTypes={curtainTypes} series={series} />
    </main>
  );
}
