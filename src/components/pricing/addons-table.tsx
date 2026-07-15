"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  togglePricingAddonActive,
  upsertPricingAddon,
} from "@/lib/actions/pricing-settings";
import type { AddonRow } from "@/lib/db/pricing-settings";

const BASIS = [
  { value: "per_metre", label: "Per metre" },
  { value: "per_unit", label: "Per unit" },
];

type Draft = {
  id: string;
  label: string;
  cost: string;
  sale: string;
  basis: AddonRow["basis"];
  is_active: boolean;
};

export function AddonsTable({ addons }: { addons: AddonRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [drafts, setDrafts] = useState<Draft[]>(() =>
    addons.map((a) => ({
      id: a.id,
      label: a.label,
      cost: a.cost_rmb ?? "",
      sale: a.sale_sgd ?? "",
      basis: a.basis,
      is_active: a.is_active,
    })),
  );

  function update(i: number, patch: Partial<Draft>) {
    setDrafts((d) => d.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }

  function saveAll() {
    startTransition(async () => {
      try {
        await Promise.all(
          drafts.map((d) =>
            upsertPricingAddon({
              id: d.id,
              label: d.label.trim(),
              cost_rmb: d.cost,
              sale_sgd: d.sale,
              basis: d.basis,
            }),
          ),
        );
        toast.success("Add-ons saved");
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Save failed");
      }
    });
  }

  function toggle(i: number) {
    const d = drafts[i];
    startTransition(async () => {
      try {
        await togglePricingAddonActive(d.id);
        update(i, { is_active: !d.is_active });
        toast.success(d.is_active ? "Add-on archived" : "Add-on reactivated");
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Update failed");
      }
    });
  }

  if (drafts.length === 0) {
    return <p className="text-sm text-slate-500 py-6 text-center">No add-ons.</p>;
  }

  return (
    <div>
      {drafts.map((d, i) => (
        <div
          key={d.id}
          className="flex flex-wrap items-center gap-2 py-2 border-b border-slate-100 last:border-0"
        >
          <Input
            value={d.label}
            onChange={(e) => update(i, { label: e.target.value })}
            className={`flex-1 min-w-40 ${d.is_active ? "" : "text-slate-400"}`}
          />
          <Input
            inputMode="decimal"
            placeholder="¥ cost/m"
            value={d.cost}
            onChange={(e) => update(i, { cost: e.target.value })}
            className="w-24"
          />
          <Input
            inputMode="decimal"
            placeholder="S$ sale"
            value={d.sale}
            onChange={(e) => update(i, { sale: e.target.value })}
            className="w-24"
          />
          <Select
            items={BASIS}
            value={d.basis}
            onValueChange={(v) =>
              update(i, { basis: (v as AddonRow["basis"]) ?? "per_metre" })
            }
          >
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BASIS.map((b) => (
                <SelectItem key={b.value} value={b.value}>
                  {b.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <button
            type="button"
            onClick={() => toggle(i)}
            disabled={pending}
            className="text-xs text-slate-500 hover:text-red-600 w-20 text-right"
          >
            {d.is_active ? "Archive" : "Reactivate"}
          </button>
        </div>
      ))}

      <div className="flex justify-end mt-4">
        <Button
          type="button"
          onClick={saveAll}
          disabled={pending}
          className="bg-teal-600 hover:bg-teal-700 text-white"
        >
          {pending ? "Saving…" : "Save add-ons"}
        </Button>
      </div>
    </div>
  );
}
