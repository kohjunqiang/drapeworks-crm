import { FabricsTable, type FabricRow } from "@/components/fabrics/fabrics-table";
import { requireSession } from "@/lib/auth/require-role";
import { db } from "@/lib/db/kysely";

export const dynamic = "force-dynamic";

export const metadata = { title: "Fabrics — Drapeworks CRM" };

export default async function FabricsPage() {
  const session = await requireSession();
  const isAdmin = session.profile.role === "admin";

  const fabrics = await db
    .selectFrom("fabrics")
    .select(["code", "name", "type", "supplier", "color", "status", "notes"])
    .orderBy("code", "asc")
    .execute();

  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
            Fabric Catalog
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Manage the curtain codes consultants can select from
          </p>
        </div>
      </div>
      <FabricsTable fabrics={fabrics as FabricRow[]} isAdmin={isAdmin} />
    </main>
  );
}
