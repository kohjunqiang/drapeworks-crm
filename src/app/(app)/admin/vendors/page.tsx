import { VendorsTable } from "@/components/vendors/vendors-table";
import { requireRole } from "@/lib/auth/require-role";
import { loadVendors } from "@/lib/db/vendors";

export const dynamic = "force-dynamic";

export const metadata = { title: "Vendors — Drapeworks CRM" };

export default async function VendorsPage() {
  // Admin-only management screen.
  await requireRole(["admin"]);

  const vendors = await loadVendors();

  return (
    <main className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <div className="mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-slate-900">Vendors</h1>
        <p className="text-sm text-slate-500 mt-1">
          Curtain suppliers. Each curtain type is priced against a chosen vendor,
          and purchase orders are split by vendor — so the Chinese name, address,
          phone and V005-style internal ref held here are what the 供应商 block
          of a PO prints. All four are optional; a blank one is omitted from the
          document.
        </p>
      </div>
      <VendorsTable vendors={vendors} />
    </main>
  );
}
