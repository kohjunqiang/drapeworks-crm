import { AddonsTable } from "@/components/pricing/addons-table";
import { BlindPricingForm } from "@/components/pricing/blind-pricing-form";
import { requireRole } from "@/lib/auth/require-role";
import { loadBlindPackageSettings } from "@/lib/db/product-pricing-settings";
import { loadAddons } from "@/lib/db/pricing-settings";

export const dynamic = "force-dynamic";
export const metadata = { title: "Blind Pricing — Drapeworks CRM" };

export default async function BlindPricingPage() {
  await requireRole(["admin"]);
  const [rows, addons] = await Promise.all([
    loadBlindPackageSettings(),
    loadAddons(),
  ]);
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Blind pricing</h2>
        <p className="mt-1 text-sm text-slate-500">
          Whole-home packages and blind-only extras, isolated from curtain rules.
        </p>
      </div>
      <BlindPricingForm initialRows={rows} />
      <section className="rounded-lg border border-slate-200 bg-white p-4 sm:p-5">
        <h2 className="font-semibold text-slate-900">Operational blind add-ons</h2>
        <p className="mb-4 mt-1 text-xs text-slate-500">
          Existing per-window extras used when a blind is priced outside a
          whole-home package.
        </p>
        <AddonsTable
          addons={addons.filter(
            (addon) => addon.applies_to === "blind" || addon.applies_to === "both",
          )}
        />
      </section>
    </div>
  );
}
