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

const PRICE_RE = /^\d+(\.\d{1,2})?$/;
const BASIS = [
  { value: "per_metre", label: "Per metre" },
  { value: "per_unit", label: "Per unit" },
];

function Row({ row }: { row: AddonRow }) {
  const router = useRouter();
  const [label, setLabel] = useState(row.label);
  const [cost, setCost] = useState(row.cost_rmb ?? "");
  const [sale, setSale] = useState(row.sale_sgd ?? "");
  const [basis, setBasis] = useState(row.basis);
  const [pending, startTransition] = useTransition();

  const valid =
    label.trim().length > 0 &&
    (cost === "" || PRICE_RE.test(cost)) &&
    (sale === "" || PRICE_RE.test(sale));
  const dirty =
    label.trim() !== row.label ||
    cost !== (row.cost_rmb ?? "") ||
    sale !== (row.sale_sgd ?? "") ||
    basis !== row.basis;

  function save() {
    startTransition(async () => {
      try {
        await upsertPricingAddon({
          id: row.id,
          label: label.trim(),
          cost_rmb: cost,
          sale_sgd: sale,
          basis,
        });
        toast.success("Add-on saved");
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Save failed");
      }
    });
  }

  function toggle() {
    startTransition(async () => {
      try {
        await togglePricingAddonActive(row.id);
        toast.success(row.is_active ? "Add-on archived" : "Add-on reactivated");
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Update failed");
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2 py-2 border-b border-slate-100 last:border-0">
      <Input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        className={`flex-1 min-w-40 ${row.is_active ? "" : "text-slate-400"}`}
      />
      <Input
        inputMode="decimal"
        placeholder="¥ cost/m"
        value={cost}
        onChange={(e) => setCost(e.target.value)}
        className="w-24"
      />
      <Input
        inputMode="decimal"
        placeholder="S$ sale"
        value={sale}
        onChange={(e) => setSale(e.target.value)}
        className="w-24"
      />
      <Select
        items={BASIS}
        value={basis}
        onValueChange={(v) => setBasis((v as AddonRow["basis"]) ?? "per_metre")}
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
      <Button
        type="button"
        size="sm"
        disabled={!dirty || !valid || pending}
        onClick={save}
        className="bg-teal-600 hover:bg-teal-700 text-white"
      >
        Save
      </Button>
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        className="text-xs text-slate-500 hover:text-red-600 w-20 text-right"
      >
        {row.is_active ? "Archive" : "Reactivate"}
      </button>
    </div>
  );
}

export function AddonsTable({ addons }: { addons: AddonRow[] }) {
  return (
    <div>
      {addons.map((a) => (
        <Row key={a.id} row={a} />
      ))}
      {addons.length === 0 && (
        <p className="text-sm text-slate-500 py-6 text-center">No add-ons.</p>
      )}
    </div>
  );
}
