import { AddonsTable } from "@/components/pricing/addons-table";
import { CurtainPricingForm } from "@/components/pricing/curtain-pricing-form";
import { CurtainPackagesManager } from "@/components/pricing/curtain-packages-manager";
import { requireRole } from "@/lib/auth/require-role";
import {
  loadCurtainPackages,
  loadCurtainPackageSettings,
  loadPricingPropertyTiers,
} from "@/lib/db/product-pricing-settings";
import { loadAddons } from "@/lib/db/pricing-settings";

export const dynamic = "force-dynamic";
export const metadata = { title: "Curtain Pricing — Drapeworks CRM" };

export default async function CurtainPricingPage() {
  await requireRole(["admin"]);
  const [
    { adjustments },
    curtainPackages,
    propertyTiers,
    addons,
  ] = await Promise.all([
    loadCurtainPackageSettings(),
    loadCurtainPackages(),
    loadPricingPropertyTiers(),
    loadAddons(),
  ]);

  if (!adjustments) {
    return (
      <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Curtain adjustment settings are missing. Run the latest database migrations.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Curtain pricing</h2>
        <p className="mt-1 text-sm text-slate-500">
          Groupbuy packages are the base price. Room adjustments and measured
          extras are always calculated on top.
        </p>
      </div>
      <CurtainPackagesManager
        initialPackages={curtainPackages}
        propertyTiers={propertyTiers}
      />
      <CurtainPricingForm initialAdjustments={adjustments} />
      <section className="rounded-lg border border-slate-200 bg-white p-4 sm:p-5">
        <h2 className="font-semibold text-slate-900">Operational curtain add-ons</h2>
        <p className="mb-4 mt-1 text-xs text-slate-500">
          These keep the add-on catalogue and COGS. Without a package, their
          selling prices apply per window. With a package, S-Fold, Blackout and
          Slim Tracks use the package rates above instead. Other add-ons remain
          additional charges. Package extras are identified by their stable catalogue keys, even if their display names change.
        </p>
        <AddonsTable
          addons={addons.filter(
            (addon) => addon.applies_to === "curtain" || addon.applies_to === "both",
          )}
        />
      </section>
    </div>
  );
}
