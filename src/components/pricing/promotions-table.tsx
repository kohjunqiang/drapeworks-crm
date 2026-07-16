"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import {
  togglePromotionActive,
  upsertPromotion,
} from "@/lib/actions/promotions";
import type { PromotionRow } from "@/lib/db/promotions";

type Draft = {
  id: string;
  name: string;
  discountPct: string;
  is_active: boolean;
};

export function PromotionsTable({
  promotions,
}: {
  promotions: PromotionRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [drafts, setDrafts] = useState<Draft[]>(() =>
    promotions.map((p) => ({
      id: p.id,
      name: p.name,
      discountPct: p.discountPct,
      is_active: p.is_active,
    })),
  );
  const [newName, setNewName] = useState("");
  const [newPct, setNewPct] = useState("");

  function update(i: number, patch: Partial<Draft>) {
    setDrafts((d) => d.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }

  function saveAll() {
    startTransition(async () => {
      try {
        await Promise.all(
          drafts.map((d) =>
            upsertPromotion({
              isNew: false,
              id: d.id,
              name: d.name.trim(),
              discountPct: d.discountPct === "" ? 0 : Number(d.discountPct),
            }),
          ),
        );
        toast.success("Promotions saved");
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Save failed");
      }
    });
  }

  function addNew() {
    if (!newName.trim()) {
      toast.error("Enter a promotion name");
      return;
    }
    startTransition(async () => {
      try {
        const created = await upsertPromotion({
          isNew: true,
          name: newName.trim(),
          discountPct: newPct === "" ? 0 : Number(newPct),
        });
        if (created) setDrafts((d) => [...d, created]);
        setNewName("");
        setNewPct("");
        toast.success("Promotion added");
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Add failed");
      }
    });
  }

  function toggle(i: number) {
    const d = drafts[i];
    startTransition(async () => {
      try {
        await togglePromotionActive(d.id);
        update(i, { is_active: !d.is_active });
        toast.success(d.is_active ? "Promotion archived" : "Promotion reactivated");
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Update failed");
      }
    });
  }

  return (
    <div>
      {drafts.map((d, i) => (
        <div
          key={d.id}
          className="flex flex-wrap items-center gap-2 py-2 border-b border-slate-100 last:border-0"
        >
          <Input
            value={d.name}
            onChange={(e) => update(i, { name: e.target.value })}
            className={`flex-1 min-w-40 ${d.is_active ? "" : "text-slate-400"}`}
          />
          <div className="relative w-24">
            <Input
              inputMode="decimal"
              placeholder="%"
              value={d.discountPct}
              onChange={(e) => update(i, { discountPct: e.target.value })}
              className="pr-6"
            />
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 text-sm">
              %
            </span>
          </div>
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

      {/* Add-new row */}
      <div className="flex flex-wrap items-center gap-2 py-2 mt-1">
        <Input
          placeholder="New promotion name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          className="flex-1 min-w-40"
        />
        <div className="relative w-24">
          <Input
            inputMode="decimal"
            placeholder="%"
            value={newPct}
            onChange={(e) => setNewPct(e.target.value)}
            className="pr-6"
          />
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 text-sm">
            %
          </span>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={addNew}
          disabled={pending}
          className="w-20"
        >
          Add
        </Button>
      </div>

      <div className="flex justify-end mt-4">
        <Button
          type="button"
          onClick={saveAll}
          disabled={pending || drafts.length === 0}
          className="bg-teal-600 hover:bg-teal-700 text-white"
        >
          {pending ? "Saving…" : "Save promotions"}
        </Button>
      </div>
    </div>
  );
}
