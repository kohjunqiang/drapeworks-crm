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

const SCOPES = [
  { value: "curtain", label: "Curtains" },
  { value: "blind", label: "Blinds" },
  { value: "both", label: "Both" },
];

const AUTO = [
  { value: "manual", label: "By hand" },
  { value: "always", label: "Always" },
  { value: "width_over", label: "Over width" },
];

type Draft = {
  id: string;
  /** No row in the database yet — save inserts rather than updates. */
  isNew?: boolean;
  label: string;
  cost: string;
  sale: string;
  basis: AddonRow["basis"];
  applies_to: AddonRow["applies_to"];
  auto_rule: AddonRow["auto_rule"];
  auto_width_over_cm: string;
  is_active: boolean;
};

/**
 * An add-on with no cost AND no sale charges nothing, so the consultation form
 * does not offer it (the same rule that hides an unpriced blind). This screen is
 * the only place that fact becomes visible, so it has to say so.
 *
 * The test is null OR zero, and it ignores auto_rule: both traps are live —
 * extra_shipping ships null/null and automatic, blinds_surcharge sits at 0/0 and
 * by hand. A check keyed on only one of those would miss the other.
 */
function chargesNothing(d: Draft): boolean {
  return !Number(d.cost || 0) && !Number(d.sale || 0);
}

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
      applies_to: a.applies_to,
      auto_rule: a.auto_rule,
      auto_width_over_cm:
        a.auto_width_over_cm != null ? String(a.auto_width_over_cm) : "",
      is_active: a.is_active,
    })),
  );

  function update(i: number, patch: Partial<Draft>) {
    setDrafts((d) =>
      d.map((row, idx) => (idx === i ? { ...row, ...patch } : row)),
    );
  }

  function addRow() {
    setDrafts((d) => [
      ...d,
      {
        id: "",
        isNew: true,
        label: "",
        cost: "",
        sale: "",
        basis: "per_metre",
        applies_to: "curtain",
        auto_rule: "manual",
        auto_width_over_cm: "",
        is_active: true,
      },
    ]);
  }

  function saveAll() {
    if (drafts.some((d) => d.label.trim() === "")) {
      toast.error("Give every add-on a name before saving");
      return;
    }
    startTransition(async () => {
      try {
        await Promise.all(
          drafts.map((d) =>
            upsertPricingAddon({
              id: d.isNew ? undefined : d.id,
              label: d.label.trim(),
              cost_rmb: d.cost,
              sale_sgd: d.sale,
              basis: d.basis,
              applies_to: d.applies_to,
              auto_rule: d.auto_rule,
              auto_width_over_cm:
                d.auto_rule === "width_over" && d.auto_width_over_cm !== ""
                  ? Number(d.auto_width_over_cm)
                  : null,
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

  return (
    <div>
      {/* The two money columns are a cost and a price and look identical once
          they are filled in — the placeholders that said which only show while
          a box is empty, which is exactly when nobody needs telling. */}
      <div className="hidden sm:flex items-center gap-2 pb-1 text-[11px] uppercase tracking-wide text-slate-400">
        <span className="flex-1 min-w-40">Add-on</span>
        <span className="w-24">¥ cost</span>
        <span className="w-24">S$ sale</span>
        <span className="w-32">Charged</span>
        <span className="w-28">Applies to</span>
        <span className="w-32">Auto</span>
        <span className="w-20">Over (cm)</span>
        <span className="w-20" />
      </div>
      {drafts.map((d, i) => (
        <div
          key={d.id || `new-${i}`}
          className="flex flex-wrap items-center gap-2 py-2 border-b border-slate-100 last:border-0"
        >
          <Input
            value={d.label}
            onChange={(e) => update(i, { label: e.target.value })}
            placeholder="Add-on name"
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
          <Select
            items={SCOPES}
            value={d.applies_to}
            onValueChange={(v) =>
              update(i, {
                applies_to: (v as AddonRow["applies_to"]) ?? "curtain",
              })
            }
          >
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SCOPES.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            items={AUTO}
            value={d.auto_rule}
            onValueChange={(v) => {
              const auto_rule = (v as AddonRow["auto_rule"]) ?? "manual";
              // Clearing the threshold alongside keeps the draft matching the
              // check constraint, so switching away and back can't save a
              // combination Postgres will reject.
              update(i, {
                auto_rule,
                auto_width_over_cm:
                  auto_rule === "width_over" ? d.auto_width_over_cm : "",
              });
            }}
          >
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AUTO.map((a) => (
                <SelectItem key={a.value} value={a.value}>
                  {a.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {d.auto_rule === "width_over" ? (
            <Input
              inputMode="numeric"
              placeholder="cm"
              value={d.auto_width_over_cm}
              onChange={(e) =>
                update(i, { auto_width_over_cm: e.target.value })
              }
              className="w-20"
            />
          ) : (
            <span className="w-20" />
          )}
          {d.isNew ? (
            <span className="w-20 text-right text-xs text-slate-400">New</span>
          ) : (
            <button
              type="button"
              onClick={() => toggle(i)}
              disabled={pending}
              className="text-xs text-slate-500 hover:text-red-600 w-20 text-right"
            >
              {d.is_active ? "Archive" : "Reactivate"}
            </button>
          )}
          {d.is_active && chargesNothing(d) && (
            <p className="w-full text-[11px] text-amber-700">
              {d.auto_rule === "manual"
                ? "Charges nothing, so it isn’t offered on consultations."
                : "Applied automatically but charges nothing — it won’t appear until you price it."}
            </p>
          )}
        </div>
      ))}

      <div className="flex justify-between items-center mt-4 gap-2">
        <Button type="button" variant="outline" onClick={addRow}>
          + Add add-on
        </Button>
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
