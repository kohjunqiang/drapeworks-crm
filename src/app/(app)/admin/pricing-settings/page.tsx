import { AddonsTable } from "@/components/pricing/addons-table";
import { AssumptionsForm } from "@/components/pricing/assumptions-form";
import { CombosTable } from "@/components/pricing/combos-table";
import { PromotionsTable } from "@/components/pricing/promotions-table";
import { requireRole } from "@/lib/auth/require-role";
import { loadCombosForSettings } from "@/lib/db/combos";
import { loadSeriesForCatalogue } from "@/lib/db/curtain-types";
import { loadAddons, loadAssumptions } from "@/lib/db/pricing-settings";
import { loadPromotionsForSettings } from "@/lib/db/promotions";
import { assumptionsFromStorage } from "@/lib/validation/pricing-settings";

export const dynamic = "force-dynamic";

export const metadata = { title: "Pricing Settings — Drapeworks CRM" };

export default async function PricingSettingsPage() {
  await requireRole(["admin"]);

  const [assumptions, addons, promotions, combos, series] = await Promise.all([
    loadAssumptions(),
    loadAddons(),
    loadPromotionsForSettings(),
    loadCombosForSettings(),
    loadSeriesForCatalogue(),
  ]);

  const activeSeries = series
    .filter((s) => s.is_active)
    .map((s) => ({ id: s.id, name: s.name }));

  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <div className="mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
          Pricing Settings
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Global assumptions and add-on prices the quote calculator uses.
          Pre-filled from your Excel — edit as needed.
        </p>
      </div>

      <section className="bg-white rounded-lg border border-slate-200 p-4 sm:p-5 mb-6">
        <h2 className="text-base font-semibold text-slate-900 mb-4">
          Assumptions
        </h2>
        {assumptions ? (
          <AssumptionsForm values={assumptionsFromStorage(assumptions)} />
        ) : (
          <p className="text-sm text-red-600">
            No assumptions row found — the migration seeds one; re-run
            `npm run db:migrate`.
          </p>
        )}
      </section>

      <section className="bg-white rounded-lg border border-slate-200 p-4 sm:p-5">
        <h2 className="text-base font-semibold text-slate-900 mb-1">Add-ons</h2>
        <p className="text-xs text-slate-500 mb-3">
          Extra treatments the customer opts into, priced on top of the base
          curtain. The rail is not one of them — it is a cost we bear and never
          bill, so it sits under Assumptions as one cost per metre.
        </p>
        <AddonsTable addons={addons} />
      </section>

      <section className="bg-white rounded-lg border border-slate-200 p-4 sm:p-5 mt-6">
        <h2 className="text-base font-semibold text-slate-900 mb-1">
          Promotions
        </h2>
        <p className="text-xs text-slate-500 mb-3">
          Reusable order-level discount tiers a consultant can apply to a quote.
        </p>
        <PromotionsTable promotions={promotions} />
      </section>

      <section className="bg-white rounded-lg border border-slate-200 p-4 sm:p-5 mt-6">
        <h2 className="text-base font-semibold text-slate-900 mb-1">Combos</h2>
        <p className="text-xs text-slate-500 mb-3">
          Fixed bundle prices a consultant can apply per window. The day/night
          series are advisory; the bundle price overrides that window&apos;s
          calculated sale.
        </p>
        <CombosTable combos={combos} series={activeSeries} />
      </section>
    </main>
  );
}
