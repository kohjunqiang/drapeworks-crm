"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { MoneyField } from "@/components/pricing/money-field";
import { useUnsavedPricing } from "@/components/pricing/use-unsaved-pricing";
import { Button } from "@/components/ui/button";
import { updateCurtainPricing } from "@/lib/actions/product-pricing-settings";
import type {
  CurtainAdjustmentSettings,
} from "@/lib/db/product-pricing-settings";

type AdjustmentKey = keyof CurtainAdjustmentSettings;
type AdjustmentGroup = {
  title: string;
  description: string;
  items: Array<{ key: AdjustmentKey; label: string; basis: string }>;
};

const GROUPS: AdjustmentGroup[] = [
  {
    title: "Night curtain upgrades",
    description: "Ultimate is charged only on the rooms individually upgraded.",
    items: [
      { key: "ultimate_from_essential_sgd", label: "Essential → Ultimate", basis: "per room" },
      { key: "ultimate_from_pls_sgd", label: "Performance / Luxe / Signature → Ultimate", basis: "per room" },
    ],
  },
  {
    title: "Day curtain upgrades",
    description: "Per room set. Width is the sum of measured curtain-window widths in that room. Blank means pricing is required, not free.",
    items: [
      { key: "zen_default_sgd", label: "Zen · below 4m", basis: "per room" },
      { key: "zen_4m_sgd", label: "Zen · 4m to below 5m", basis: "per room" },
      { key: "zen_5m_sgd", label: "Zen · 5m and above", basis: "per room" },
      { key: "s_fold_3m_sgd", label: "S-Fold · below 4m", basis: "per room" },
      { key: "s_fold_4m_sgd", label: "S-Fold · exactly 4m", basis: "per room" },
      { key: "s_fold_above_4m_sgd", label: "S-Fold · above 4m", basis: "per room · optional" },
    ],
  },
  {
    title: "Add or remove layers",
    description: "Remove values are positive credits that the calculator subtracts.",
    items: [
      { key: "remove_day_sgd", label: "Remove Day", basis: "credit per room" },
      { key: "remove_essential_sgd", label: "Remove Essential", basis: "credit per room" },
      { key: "remove_pls_sgd", label: "Remove Performance / Luxe / Signature", basis: "credit per room" },
      { key: "add_day_sgd", label: "Add Day", basis: "per room" },
      { key: "add_essential_sgd", label: "Add Essential", basis: "per room" },
      { key: "add_pls_sgd", label: "Add Performance / Luxe / Signature", basis: "per room" },
    ],
  },
  {
    title: "Measured extras",
    description: "These rates multiply the measured room width in metres.",
    items: [
      { key: "blackout_per_m_sgd", label: "Add Blackout", basis: "per metre" },
      { key: "slim_single_per_m_sgd", label: "Slim Track · Single", basis: "per metre" },
      { key: "slim_double_per_m_sgd", label: "Slim Track · Double", basis: "per metre" },
    ],
  },
];

export function CurtainPricingForm({
  initialAdjustments,
}: {
  initialAdjustments: CurtainAdjustmentSettings;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [adjustments, setAdjustments] = useState(initialAdjustments);
  const [savedSignature, setSavedSignature] = useState(() =>
    JSON.stringify(initialAdjustments),
  );
  const signature = JSON.stringify(adjustments);
  const dirty = signature !== savedSignature;
  useUnsavedPricing(dirty);

  function save() {
    startTransition(async () => {
      try {
        await updateCurtainPricing({
          adjustments,
        });
        setSavedSignature(signature);
        toast.success("Curtain pricing saved");
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Save failed");
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-600">
        These rates apply automatically when a curtain package is selected.
        Room tier charges and credits belong to each package above. Matching
        add-on selling prices are replaced, never charged twice; COGS is unchanged.
        Existing orders keep their saved package rates. An unset rate blocks a final quote.
      </div>

      {GROUPS.map((group) => (
        <section
          key={group.title}
          className="overflow-hidden rounded-lg border border-slate-200 bg-white"
        >
          <header className="border-b border-slate-200 px-4 py-4 sm:px-5">
            <h2 className="font-semibold text-slate-900">{group.title}</h2>
            <p className="mt-1 text-xs text-slate-500">{group.description}</p>
          </header>
          <div className="divide-y divide-slate-100">
            {group.items.map((item) => (
              <div
                key={item.key}
                className="grid gap-2 px-4 py-3 sm:grid-cols-[1fr_130px_170px] sm:items-center sm:px-5"
              >
                <span className="text-sm text-slate-800">{item.label}</span>
                <span className="text-xs text-slate-500">{item.basis}</span>
                <MoneyField
                  ariaLabel={item.label}
                  value={adjustments[item.key]}
                  onChange={(value) =>
                    setAdjustments((current) => ({
                      ...current,
                      [item.key]: value,
                    }))
                  }
                  disabled={pending}
                />
              </div>
            ))}
          </div>
        </section>
      ))}

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
