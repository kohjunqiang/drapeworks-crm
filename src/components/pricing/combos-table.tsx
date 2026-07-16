"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { AppSelect } from "@/components/ui/app-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { toggleComboActive, upsertCombo } from "@/lib/actions/combos";
import type { ComboRow } from "@/lib/db/combos";

export type SeriesOption = { id: string; name: string };

type Draft = {
  id: string;
  name: string;
  day_series_id: string; // "" = none
  night_series_id: string;
  price: string;
  is_active: boolean;
};

export function CombosTable({
  combos,
  series,
}: {
  combos: ComboRow[];
  series: SeriesOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [drafts, setDrafts] = useState<Draft[]>(() =>
    combos.map((c) => ({
      id: c.id,
      name: c.name,
      day_series_id: c.day_series_id ?? "",
      night_series_id: c.night_series_id ?? "",
      price: c.price_sgd,
      is_active: c.is_active,
    })),
  );
  const [draftNew, setDraftNew] = useState<Omit<Draft, "id" | "is_active">>({
    name: "",
    day_series_id: "",
    night_series_id: "",
    price: "",
  });

  const seriesOptions = series.map((s) => ({ value: s.id, label: s.name }));

  function update(i: number, patch: Partial<Draft>) {
    setDrafts((d) => d.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }

  function saveAll() {
    startTransition(async () => {
      try {
        await Promise.all(
          drafts.map((d) =>
            upsertCombo({
              isNew: false,
              id: d.id,
              name: d.name.trim(),
              day_series_id: d.day_series_id || undefined,
              night_series_id: d.night_series_id || undefined,
              price_sgd: d.price,
            }),
          ),
        );
        toast.success("Combos saved");
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Save failed");
      }
    });
  }

  function addNew() {
    if (!draftNew.name.trim()) {
      toast.error("Enter a combo name");
      return;
    }
    startTransition(async () => {
      try {
        const created = await upsertCombo({
          isNew: true,
          name: draftNew.name.trim(),
          day_series_id: draftNew.day_series_id || undefined,
          night_series_id: draftNew.night_series_id || undefined,
          price_sgd: draftNew.price,
        });
        if (created)
          setDrafts((d) => [
            ...d,
            {
              id: created.id,
              name: created.name,
              day_series_id: created.day_series_id ?? "",
              night_series_id: created.night_series_id ?? "",
              price: created.price_sgd,
              is_active: created.is_active,
            },
          ]);
        setDraftNew({
          name: "",
          day_series_id: "",
          night_series_id: "",
          price: "",
        });
        toast.success("Combo added");
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
        await toggleComboActive(d.id);
        update(i, { is_active: !d.is_active });
        toast.success(d.is_active ? "Combo archived" : "Combo reactivated");
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
            className={`flex-1 min-w-36 ${d.is_active ? "" : "text-slate-400"}`}
          />
          <AppSelect
            value={d.day_series_id}
            onChange={(v) => update(i, { day_series_id: v })}
            options={seriesOptions}
            noneLabel="Day: none"
            triggerClassName="w-40"
          />
          <AppSelect
            value={d.night_series_id}
            onChange={(v) => update(i, { night_series_id: v })}
            options={seriesOptions}
            noneLabel="Night: none"
            triggerClassName="w-40"
          />
          <div className="relative w-28">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-sm">
              S$
            </span>
            <Input
              inputMode="decimal"
              placeholder="price"
              value={d.price}
              onChange={(e) => update(i, { price: e.target.value })}
              className="pl-8"
            />
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
          placeholder="New combo name"
          value={draftNew.name}
          onChange={(e) => setDraftNew((s) => ({ ...s, name: e.target.value }))}
          className="flex-1 min-w-36"
        />
        <AppSelect
          value={draftNew.day_series_id}
          onChange={(v) => setDraftNew((s) => ({ ...s, day_series_id: v }))}
          options={seriesOptions}
          noneLabel="Day: none"
          triggerClassName="w-40"
        />
        <AppSelect
          value={draftNew.night_series_id}
          onChange={(v) => setDraftNew((s) => ({ ...s, night_series_id: v }))}
          options={seriesOptions}
          noneLabel="Night: none"
          triggerClassName="w-40"
        />
        <div className="relative w-28">
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-sm">
            S$
          </span>
          <Input
            inputMode="decimal"
            placeholder="price"
            value={draftNew.price}
            onChange={(e) => setDraftNew((s) => ({ ...s, price: e.target.value }))}
            className="pl-8"
          />
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
          {pending ? "Saving…" : "Save combos"}
        </Button>
      </div>
    </div>
  );
}
