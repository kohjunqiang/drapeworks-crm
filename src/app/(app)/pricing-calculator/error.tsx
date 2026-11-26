"use client";
import { Button } from "@/components/ui/button";
export default function PricingError({ reset }: { reset: () => void }) {
  return <main className="mx-auto max-w-3xl p-4 sm:p-6"><h1 className="text-2xl font-semibold">Pricing Calculator</h1><div role="alert" className="mt-4 rounded-lg border border-red-200 bg-white p-6"><p>Current pricing could not be loaded. Please try again.</p><Button variant="outline" className="mt-4 min-h-11" onClick={reset}>Retry pricing</Button></div></main>;
}
