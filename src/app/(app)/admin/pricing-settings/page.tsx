import { AddonsTable } from "@/components/pricing/addons-table";
import { AssumptionsForm } from "@/components/pricing/assumptions-form";
import { requireRole } from "@/lib/auth/require-role";
import { loadAddons, loadAssumptions } from "@/lib/db/pricing-settings";
import { assumptionsFromStorage } from "@/lib/validation/pricing-settings";

export const dynamic = "force-dynamic";

export const metadata = { title: "Pricing Settings — Drapeworks CRM" };

export default async function PricingSettingsPage() {
  await requireRole(["admin"]);

  const [assumptions, addons] = await Promise.all([
    loadAssumptions(),
    loadAddons(),
  ]);

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
          Extra treatments and hardware priced on top of the base curtain.
        </p>
        <AddonsTable addons={addons} />
      </section>
    </main>
  );
}
