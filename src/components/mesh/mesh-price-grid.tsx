"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { upsertMeshPrice } from "@/lib/actions/mesh-catalogue";
import type {
  MeshCategoryRow,
  MeshPriceRow,
  MeshSizeBandRow,
} from "@/lib/db/mesh-catalogue";
import { centsToDisplay } from "@/lib/money";
// The same key the calculator uses, so the grid and the pricing lookup can't
// disagree about what identifies a cell.
import { priceKey } from "@/lib/pricing/mesh-calculator";
import { cm2ToSqm } from "@/lib/validation/mesh-catalogue";

// The category × band price grid. Each cell holds an RMB cost and an SGD sale,
// either of which may be blank:
//   - blank sale  → the panel is unpriced and the quote warns
//   - blank cost  → the customer price is right but margin reads ~100%, which
//                   no margin floor can catch. Flagged separately, in amber.
// Both states are real — the grid gets filled in cell by cell.

const CELL_INPUT =
  "w-20 px-1.5 py-1 border border-slate-200 rounded text-sm text-right focus:outline-none focus:border-teal-500 bg-white";

type Draft = { cost: string; sale: string };

export function MeshPriceGrid({
  categories,
  bands,
  prices,
}: {
  categories: MeshCategoryRow[];
  bands: MeshSizeBandRow[];
  prices: MeshPriceRow[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});

  const activeCategories = categories.filter((c) => c.is_active);
  const activeBands = bands.filter((b) => b.is_active);

  const byKey = new Map(
    prices.map((p) => [priceKey(p.category_id, p.band_id), p]),
  );

  function cellValue(categoryId: string, bandId: string): Draft {
    const k = priceKey(categoryId, bandId);
    if (drafts[k]) return drafts[k];
    const row = byKey.get(k);
    return {
      cost:
        row?.cost_rmb_cents == null ? "" : centsToDisplay(row.cost_rmb_cents),
      sale:
        row?.sale_sgd_cents == null ? "" : centsToDisplay(row.sale_sgd_cents),
    };
  }

  function setDraft(categoryId: string, bandId: string, patch: Partial<Draft>) {
    const k = priceKey(categoryId, bandId);
    setDrafts((d) => ({
      ...d,
      [k]: { ...cellValue(categoryId, bandId), ...patch },
    }));
  }

  function save(categoryId: string, bandId: string) {
    const v = cellValue(categoryId, bandId);
    startTransition(async () => {
      try {
        await upsertMeshPrice({
          category_id: categoryId,
          band_id: bandId,
          cost_rmb: v.cost,
          sale_sgd: v.sale,
        });
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not save price");
      }
    });
  }

  if (activeCategories.length === 0 || activeBands.length === 0) {
    return (
      <section className="mb-8">
        <h2 className="text-base font-semibold text-slate-900 mb-0.5">
          Prices
        </h2>
        <p className="text-sm text-slate-500 mb-3">
          Flat price per panel, by category and size band.
        </p>
        <div className="bg-white rounded-lg border border-slate-200 text-center py-10 px-4 text-sm text-slate-500">
          Add at least one active category and one active size band before
          setting prices.
        </div>
      </section>
    );
  }

  return (
    <section className="mb-8">
      <h2 className="text-base font-semibold text-slate-900 mb-0.5">Prices</h2>
      <p className="text-sm text-slate-500 mb-3">
        Flat price per panel, by category and size band. Changes save when you
        leave a field. A blank sale leaves the panel unpriced; a blank cost
        makes margin unreliable.
      </p>

      <div className="bg-white rounded-lg border border-slate-200 overflow-x-auto">
        <table className="w-full text-sm min-w-[40rem]">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Category</th>
              {activeBands.map((b) => (
                <th key={b.id} className="text-right px-4 py-3 font-medium">
                  <div>{b.label}</div>
                  <div className="text-xs font-normal text-slate-400">
                    {b.max_area_cm2 == null
                      ? "no limit"
                      : `≤ ${cm2ToSqm(b.max_area_cm2)} m²`}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {activeCategories.map((c) => (
              <tr key={c.id}>
                <td className="px-4 py-3 font-medium text-slate-900 align-top">
                  {c.name}
                </td>
                {activeBands.map((b) => {
                  const v = cellValue(c.id, b.id);
                  const missingCost = v.sale !== "" && v.cost === "";
                  return (
                    <td key={b.id} className="px-4 py-3 text-right align-top">
                      <div className="flex flex-col items-end gap-1">
                        <label className="flex items-center gap-1">
                          <span className="text-xs text-slate-400">¥</span>
                          <input
                            aria-label={`${c.name} ${b.label} cost in RMB`}
                            inputMode="decimal"
                            className={CELL_INPUT}
                            value={v.cost}
                            onChange={(e) =>
                              setDraft(c.id, b.id, { cost: e.target.value })
                            }
                            onBlur={() => save(c.id, b.id)}
                          />
                        </label>
                        <label className="flex items-center gap-1">
                          <span className="text-xs text-slate-400">S$</span>
                          <input
                            aria-label={`${c.name} ${b.label} sale in SGD`}
                            inputMode="decimal"
                            className={CELL_INPUT}
                            value={v.sale}
                            onChange={(e) =>
                              setDraft(c.id, b.id, { sale: e.target.value })
                            }
                            onBlur={() => save(c.id, b.id)}
                          />
                        </label>
                        {missingCost && (
                          <span className="text-xs text-amber-700">
                            no cost — margin unreliable
                          </span>
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
