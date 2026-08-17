"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { upsertMeshMinimumArea } from "@/lib/actions/mesh-catalogue";
import type {
  MeshCategoryRow,
  MeshMinimumRow,
  MeshSystemRow,
} from "@/lib/db/mesh-catalogue";
import { cm2ToSqm } from "@/lib/validation/mesh-catalogue";

import { CatalogueSection } from "./catalogue-shell";

const CELL_INPUT =
  "w-20 px-2 py-1 border border-slate-200 rounded text-sm text-right " +
  "focus:outline-none focus:border-teal-500 bg-white tabular-nums";

const key = (categoryId: string, systemId: string) =>
  `${categoryId}:${systemId}`;

export function MeshMinimumsGrid({
  categories,
  systems,
  minimums,
}: {
  categories: MeshCategoryRow[];
  systems: MeshSystemRow[];
  minimums: MeshMinimumRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const stored = useMemo(
    () =>
      Object.fromEntries(
        minimums.map((m) => [
          key(m.category_id, m.system_id),
          cm2ToSqm(m.min_area_cm2_per_leaf),
        ]),
      ),
    [minimums],
  );

  // `saved` tracks what is on the server so the Save button can tell whether
  // anything actually changed. It is separate from the prop because a save
  // updates it immediately, before the refreshed page arrives.
  const [saved, setSaved] = useState<Record<string, string>>(stored);
  const [draft, setDraft] = useState<Record<string, string>>(stored);

  const activeCategories = categories.filter((c) => c.is_active);
  const activeSystems = systems.filter((s) => s.is_active);

  // Only the cells that actually differ get written, so saving does not churn
  // every row in the grid.
  const changed = useMemo(() => {
    const out: { categoryId: string; systemId: string; value: string }[] = [];
    for (const c of activeCategories) {
      for (const sys of activeSystems) {
        const k = key(c.id, sys.id);
        const next = (draft[k] ?? "").trim();
        if (next !== (saved[k] ?? "")) {
          out.push({ categoryId: c.id, systemId: sys.id, value: next });
        }
      }
    }
    return out;
  }, [draft, saved, activeCategories, activeSystems]);

  function saveAll() {
    if (changed.length === 0) return;
    startTransition(async () => {
      try {
        for (const cell of changed) {
          await upsertMeshMinimumArea({
            category_id: cell.categoryId,
            system_id: cell.systemId,
            min_sqm_per_leaf: cell.value,
          });
        }
        setSaved(draft);
        toast.success(
          changed.length === 1
            ? "Minimum saved"
            : `${changed.length} minimums saved`,
        );
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Save failed");
      }
    });
  }

  return (
    <CatalogueSection
      title="Minimum billable area"
      description="The smallest area a panel is charged for, in m² PER LEAF. A single draw takes it once, a double takes it twice — so a 2 m² minimum means 4 m² on a double. Leave blank for no minimum."
      isEmpty={activeCategories.length === 0 || activeSystems.length === 0}
      emptyMessage="Add at least one category and one system to set minimums."
    >
      <table className="w-full text-sm min-w-[36rem]">
        <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
          <tr>
            <th className="text-left px-4 py-3 font-medium">Category</th>
            {activeSystems.map((s) => (
              <th key={s.id} className="text-right px-4 py-3 font-medium">
                {s.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {activeCategories.map((c) => (
            <tr key={c.id}>
              <td className="px-4 py-3 font-medium text-slate-900 align-middle">
                {c.name}
              </td>
              {activeSystems.map((s) => (
                <td key={s.id} className="px-4 py-3 text-right">
                  <label className="inline-flex items-center gap-1">
                    <input
                      aria-label={`${c.name} on ${s.name}, minimum m² per leaf`}
                      inputMode="decimal"
                      className={CELL_INPUT}
                      value={draft[key(c.id, s.id)] ?? ""}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          [key(c.id, s.id)]: e.target.value,
                        }))
                      }
                    />
                    <span className="text-xs text-slate-400">m²</span>
                  </label>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 py-3 border-t border-slate-100">
        <p className="text-xs text-slate-500 max-w-xl">
          The area is floored, not the price — a panel under the minimum is
          charged as though it were exactly that size, at the category&rsquo;s
          usual rate. It floors cost as well as sale, so the margin stays
          honest.
        </p>
        <div className="flex items-center gap-3 shrink-0">
          {changed.length > 0 && !pending && (
            <span className="text-xs text-amber-700">
              {changed.length} unsaved
            </span>
          )}
          <Button
            onClick={saveAll}
            disabled={pending || changed.length === 0}
            className="bg-teal-600 hover:bg-teal-700 text-white"
          >
            {pending ? "Saving…" : "Save minimums"}
          </Button>
        </div>
      </div>
    </CatalogueSection>
  );
}
