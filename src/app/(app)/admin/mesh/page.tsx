import Link from "next/link";

import { MeshCategoriesTable } from "@/components/mesh/mesh-categories-table";
import { MeshColoursTable } from "@/components/mesh/mesh-colours-table";
import { MeshSystemBandsTable } from "@/components/mesh/mesh-system-bands-table";
import { MeshSystemsTable } from "@/components/mesh/mesh-systems-table";
import { requireRole } from "@/lib/auth/require-role";
import { loadAssumptions } from "@/lib/db/pricing-settings";
import {
  loadMeshCategories,
  loadMeshColours,
  loadMeshSystemBands,
  loadMeshSystems,
} from "@/lib/db/mesh-catalogue";
import { loadVendors } from "@/lib/db/vendors";

export const dynamic = "force-dynamic";

export const metadata = { title: "Mesh catalogue — Drapeworks CRM" };

export default async function MeshCataloguePage() {
  await requireRole(["admin"]);

  const [categories, colours, systemBands, systems, vendors, assumptions] =
    await Promise.all([
      loadMeshCategories(),
      loadMeshColours(),
      loadMeshSystemBands(),
      loadMeshSystems(),
      loadVendors(),
      loadAssumptions(),
    ]);

  // Both halves of the sellable gate, so an admin can see exactly what's still
  // missing rather than wondering why Mesh isn't offered on a consultation.
  const hasPricedCategory = categories.some(
    (c) => c.is_active && c.sale_sgd_cents_per_sqft != null,
  );
  const hasInstallCost = (assumptions?.handyman_mesh_sgd_cents ?? 0) > 0;
  const sellable = hasPricedCategory && hasInstallCost;

  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <div className="mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
          Mesh catalogue
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Window mesh categories, their per-square-foot rates, the colour list and
          the track-system matrix. Everything the consultation form offers
          comes from here.
        </p>
      </div>

      {!sellable && (
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-medium">
            Mesh isn&rsquo;t available on consultations yet.
          </p>
          <ul className="mt-1.5 space-y-1 list-disc list-inside">
            {!hasPricedCategory && (
              <li>
                No category has a sale rate. Set S$/ft² on at least one active
                category below.
              </li>
            )}
            {!hasInstallCost && (
              <li>
                Mesh install cost is S$0. Set it in{" "}
                <Link
                  href="/admin/pricing-settings"
                  className="underline font-medium"
                >
                  Pricing settings
                </Link>
                , or every mesh quote will overstate its margin.
              </li>
            )}
          </ul>
        </div>
      )}

      <MeshCategoriesTable
        categories={categories}
        vendors={vendors.filter((v) => v.is_active)}
      />
      <MeshColoursTable colours={colours} />
      <MeshSystemBandsTable bands={systemBands} />
      <MeshSystemsTable systems={systems} />
    </main>
  );
}
