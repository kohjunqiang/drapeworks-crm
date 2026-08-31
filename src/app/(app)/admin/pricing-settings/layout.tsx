import { PricingTabs } from "@/components/pricing/pricing-tabs";

export default function PricingSettingsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-5">
        <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">
          Pricing Settings
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Each product line owns its selling-price rules. Shared assumptions are
          limited to costs and company-wide policies.
        </p>
      </div>
      <PricingTabs />
      <div className="pt-6">{children}</div>
    </main>
  );
}
