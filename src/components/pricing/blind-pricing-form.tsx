"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { MoneyField } from "@/components/pricing/money-field";
import { useUnsavedPricing } from "@/components/pricing/use-unsaved-pricing";
import { Button } from "@/components/ui/button";
import { updateBlindPricing } from "@/lib/actions/product-pricing-settings";
import type { BlindPackageSettingsRow } from "@/lib/db/product-pricing-settings";
import type { BlindPackageFamily } from "@/lib/db/schema";

const FAMILIES: Array<{ key: BlindPackageFamily; label: string }> = [
  { key: "venetian_roman_non_200", label: "Venetian / Roman Non-200" },
  { key: "roller", label: "Roller" },
  { key: "combi", label: "Combi" },
  { key: "roman_200", label: "Roman 200 Series" },
];

export function BlindPricingForm({ initialRows }: { initialRows: BlindPackageSettingsRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [rows, setRows] = useState(initialRows);
  const [savedSignature, setSavedSignature] = useState(() =>
    JSON.stringify(initialRows),
  );
  const signature = JSON.stringify(rows);
  const dirty = signature !== savedSignature;
  useUnsavedPricing(dirty);

  function update(id: string, family: BlindPackageFamily, value: string) {
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, [family]: value } : row)),
    );
  }

  function save() {
    startTransition(async () => {
      try {
        await updateBlindPricing({
          prices: rows.flatMap((row) =>
            FAMILIES.map((family) => ({
              property_tier_id: row.id,
              family: family.key,
              price_sgd: row[family.key],
            })),
          ),
        });
        setSavedSignature(signature);
        toast.success("Blind pricing saved");
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Save failed");
      }
    });
  }

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
        These are whole-home packages. They remain separate from per-window blind
        series prices and curtain Groupbuy rules.
      </div>
      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <header className="border-b border-slate-200 px-4 py-4 sm:px-5">
          <h2 className="font-semibold text-slate-900">Whole-home blind packages</h2>
          <p className="mt-1 text-xs text-slate-500">
            An empty field means that package is unavailable for the property tier.
          </p>
        </header>
        <div className="divide-y divide-slate-100">
          {rows.map((row) => (
            <div key={row.id} className="px-4 py-4 sm:px-5">
              <div className="mb-3">
                <p className="text-sm font-medium text-slate-800">{row.label}</p>
                <p className="text-xs text-slate-500">{row.roomSetCount} room sets</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {FAMILIES.map((family) => (
                  <label key={family.key} className="space-y-1 text-xs font-medium text-slate-600">
                    <span>{family.label}</span>
                    <MoneyField
                      ariaLabel={`${row.label} ${family.label}`}
                      value={row[family.key]}
                      onChange={(value) => update(row.id, family.key, value)}
                      disabled={pending}
                    />
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
      <div className="sticky bottom-0 -mx-4 flex items-center justify-between border-t border-slate-200 bg-white/95 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:mx-0 sm:rounded-lg sm:border">
        <span aria-live="polite" className="text-xs text-slate-500">
          {dirty ? "Unsaved package pricing changes" : "Package pricing saved"}
        </span>
        <Button
          onClick={save}
          disabled={pending || !dirty}
          className="bg-teal-600 text-white hover:bg-teal-700"
        >
          {pending ? "Saving…" : "Save package pricing"}
        </Button>
      </div>
    </div>
  );
}
