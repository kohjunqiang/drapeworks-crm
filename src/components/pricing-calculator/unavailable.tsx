"use client";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
export function PricingUnavailable() {
  const router = useRouter();
  return <main className="mx-auto max-w-3xl p-4 sm:p-6"><h1 className="text-2xl font-semibold">Pricing Calculator</h1><div className="mt-4 rounded-lg border border-slate-200 bg-white p-6"><h2 className="font-semibold">Pricing is not available yet</h2><p className="mt-2 text-sm text-slate-600">An administrator needs to configure pricing and at least one active, priced fabric or blind series.</p><Button className="mt-4 min-h-11" variant="outline" onClick={() => router.refresh()}>Retry pricing</Button></div></main>;
}
