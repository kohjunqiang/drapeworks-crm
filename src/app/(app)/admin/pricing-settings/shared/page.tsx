import { AssumptionsForm } from "@/components/pricing/assumptions-form";
import { PromotionsTable } from "@/components/pricing/promotions-table";
import { requireRole } from "@/lib/auth/require-role";
import { loadAssumptions } from "@/lib/db/pricing-settings";
import { loadPromotionsForSettings } from "@/lib/db/promotions";
import { assumptionsFromStorage } from "@/lib/validation/pricing-settings";

export const dynamic = "force-dynamic";
export const metadata = { title: "Shared Pricing Assumptions — Drapeworks CRM" };

export default async function SharedPricingPage() {
  await requireRole(["admin"]);
  const [assumptions, promotions] = await Promise.all([
    loadAssumptions(),
    loadPromotionsForSettings(),
  ]);
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Shared assumptions</h2>
        <p className="mt-1 text-sm text-slate-500">
          Company-wide costs and margin policy. Product selling prices belong in
          their own tabs.
        </p>
      </div>
      <section className="rounded-lg border border-slate-200 bg-white p-4 sm:p-5">
        {assumptions ? (
          <AssumptionsForm values={assumptionsFromStorage(assumptions)} />
        ) : (
          <p className="text-sm text-red-600">No assumptions row found.</p>
        )}
      </section>
      <section className="rounded-lg border border-slate-200 bg-white p-4 sm:p-5">
        <h2 className="font-semibold text-slate-900">Promotions</h2>
        <p className="mb-4 mt-1 text-xs text-slate-500">
          Order-level discounts. Package discountability must be decided before
          the new packages are enabled on consultations.
        </p>
        <PromotionsTable promotions={promotions} />
      </section>
    </div>
  );
}
