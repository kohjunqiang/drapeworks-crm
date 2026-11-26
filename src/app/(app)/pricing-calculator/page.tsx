import { requireRole } from "@/lib/auth/require-role";
import { loadQuickQuoteOptions } from "@/lib/db/quick-quote";
import { loadActiveCombos } from "@/lib/db/combos";
import { loadCurtainPackages } from "@/lib/db/product-pricing-settings";
import { loadCalcConfig } from "@/lib/pricing/order-quote";
import { PricingCalculator } from "@/components/pricing-calculator";
import { PricingUnavailable } from "@/components/pricing-calculator/unavailable";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pricing Calculator — Drapeworks CRM" };
export default async function PricingCalculatorPage() {
  const session = await requireRole(["consultant", "admin"]);
  const [options, config, packages, combos] = await Promise.all([
    loadQuickQuoteOptions(), loadCalcConfig(), loadCurtainPackages(), loadActiveCombos(),
  ]);
  if (!config || options.length === 0) return <PricingUnavailable />;
  return <PricingCalculator key={session.profile.id} profileId={session.profile.id} data={{ options, config, packages: packages.filter((p) => p.isActive), combos }} />;
}
