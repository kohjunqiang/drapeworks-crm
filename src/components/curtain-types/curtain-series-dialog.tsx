"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  toggleCurtainSeriesActive,
  upsertCurtainSeries,
} from "@/lib/actions/curtain-series";
import type { CurtainSeriesRow } from "@/lib/db/curtain-types";
import type { VendorOption } from "@/lib/db/vendors";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  series: CurtainSeriesRow[];
  vendors: VendorOption[];
};

const PRICE_RE = /^\d+(\.\d{1,2})?$/;

function SeriesRow({
  row,
  vendors,
}: {
  row: CurtainSeriesRow;
  vendors: VendorOption[];
}) {
  const router = useRouter();
  const [name, setName] = useState(row.name);
  const [vendorId, setVendorId] = useState(row.vendor_id ?? "");
  const [cost, setCost] = useState(row.cost_rmb ?? "");
  const [sale, setSale] = useState(row.sale_sgd ?? "");
  const [pending, startTransition] = useTransition();

  const nameValid = name.trim().length > 0;
  const pricesValid =
    (cost === "" || PRICE_RE.test(cost)) && (sale === "" || PRICE_RE.test(sale));
  const dirty =
    name.trim() !== row.name ||
    vendorId !== (row.vendor_id ?? "") ||
    cost !== (row.cost_rmb ?? "") ||
    sale !== (row.sale_sgd ?? "");

  function save() {
    startTransition(async () => {
      try {
        await upsertCurtainSeries({
          isNew: false,
          id: row.id,
          name: name.trim(),
          vendor_id: vendorId,
          cost_rmb: cost,
          sale_sgd: sale,
        });
        toast.success("Series saved");
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Save failed");
      }
    });
  }

  function toggle() {
    startTransition(async () => {
      try {
        await toggleCurtainSeriesActive(row.id);
        toast.success(row.is_active ? "Series archived" : "Series reactivated");
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Update failed");
      }
    });
  }

  return (
    <div className="py-3 border-b border-slate-100 last:border-0 space-y-2">
      <div className="flex items-center gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={row.is_active ? "" : "text-slate-400"}
        />
        <span className="text-xs text-slate-400 w-14 text-right flex-shrink-0">
          {row.typeCount} {row.typeCount === 1 ? "type" : "types"}
        </span>
        <button
          type="button"
          onClick={toggle}
          disabled={pending}
          className="text-xs text-slate-500 hover:text-red-600 w-20 text-right flex-shrink-0"
        >
          {row.is_active ? "Archive" : "Reactivate"}
        </button>
      </div>
      <div className="flex items-center gap-2">
        <Select
          items={vendors.map((v) => ({ value: v.id, label: v.name }))}
          value={vendorId || null}
          onValueChange={(v) => setVendorId(v ?? "")}
        >
          <SelectTrigger className="flex-1 min-w-0">
            <SelectValue placeholder="Vendor" />
          </SelectTrigger>
          <SelectContent>
            {vendors.map((v) => (
              <SelectItem key={v.id} value={v.id}>
                {v.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          inputMode="decimal"
          placeholder="¥ cost/m"
          value={cost}
          onChange={(e) => setCost(e.target.value)}
          className="w-24"
        />
        <Input
          inputMode="decimal"
          placeholder="S$ sale/m"
          value={sale}
          onChange={(e) => setSale(e.target.value)}
          className="w-24"
        />
        <Button
          type="button"
          size="sm"
          disabled={!dirty || !nameValid || !pricesValid || pending}
          onClick={save}
          className="bg-teal-600 hover:bg-teal-700 text-white flex-shrink-0"
        >
          Save
        </Button>
      </div>
    </div>
  );
}

export function CurtainSeriesDialog({
  open,
  onOpenChange,
  series,
  vendors,
}: Props) {
  const router = useRouter();
  const [newName, setNewName] = useState("");
  const [pending, startTransition] = useTransition();

  function add() {
    const name = newName.trim();
    if (!name) return;
    startTransition(async () => {
      try {
        await upsertCurtainSeries({ isNew: true, name });
        toast.success("Series added");
        setNewName("");
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not add series");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Manage series &amp; pricing</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-slate-500">
          Pricing is set per series — every curtain type in a series inherits its
          vendor, cost and sale price.
        </p>

        <div className="flex items-center gap-2">
          <Input
            placeholder="New series name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
          />
          <Button
            type="button"
            onClick={add}
            disabled={pending || newName.trim().length === 0}
            className="bg-teal-600 hover:bg-teal-700 text-white"
          >
            Add
          </Button>
        </div>

        <div className="mt-1 max-h-96 overflow-y-auto">
          {series.length === 0 ? (
            <p className="text-sm text-slate-500 py-6 text-center">
              No series yet. Add your first one above.
            </p>
          ) : (
            series.map((s) => (
              <SeriesRow key={s.id} row={s} vendors={vendors} />
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
