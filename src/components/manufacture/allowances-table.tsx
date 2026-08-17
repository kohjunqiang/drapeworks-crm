"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { saveManufactureAllowance } from "@/lib/actions/manufacture";
import { applyAllowance } from "@/lib/manufacture/allowance";
import { allowanceSchema } from "@/lib/validation/manufacture";

export type AllowanceRow = {
  productLine: "curtain" | "blind" | "mesh";
  widthDeltaCm: number | null;
  heightDeltaCm: number | null;
};

type Draft = { width: string; height: string };

const LABELS: Record<AllowanceRow["productLine"], string> = {
  curtain: "Curtains",
  blind: "Blinds",
  mesh: "Mesh",
};

const CELL_INPUT =
  "w-20 px-2 py-1 border border-slate-200 rounded text-sm text-right " +
  "focus:outline-none focus:border-teal-500 bg-white tabular-nums";

// The opening the preview is worked out against. A concrete example is the
// clearest possible statement of which way the sign points.
const EXAMPLE = { widthCm: 150, heightCm: 220 };

// A true minus sign when READING. A hyphen at 12px is easy to lose, and losing
// it here means a vendor is told to build the piece bigger than the opening.
// The inputs stay plain ASCII so typing is never ambiguous.
const MINUS = "−";
const signed = (n: number) => `${n < 0 ? MINUS : ""}${Math.abs(n)}`;

const toDraft = (r: AllowanceRow): Draft => ({
  width: r.widthDeltaCm == null ? "" : String(r.widthDeltaCm),
  height: r.heightDeltaCm == null ? "" : String(r.heightDeltaCm),
});

export function AllowancesTable({ rows }: { rows: AllowanceRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [savingLine, setSavingLine] = useState<string | null>(null);

  const stored = useMemo(
    () => Object.fromEntries(rows.map((r) => [r.productLine, toDraft(r)])),
    [rows],
  );

  // `saved` tracks what is on the server so each row's Save button can tell
  // whether anything actually changed. It is separate from the prop because a
  // save updates it immediately, before the refreshed page arrives.
  const [saved, setSaved] = useState<Record<string, Draft>>(stored);
  const [draft, setDraft] = useState<Record<string, Draft>>(stored);

  function set(line: string, field: keyof Draft, value: string) {
    setDraft((d) => ({ ...d, [line]: { ...d[line], [field]: value } }));
  }

  function save(line: AllowanceRow["productLine"]) {
    const next = draft[line];
    const parsed = allowanceSchema.safeParse({
      productLine: line,
      widthDeltaCm: Number(next.width),
      heightDeltaCm: Number(next.height),
    });

    // Validated client-side against the same schema the action uses, so a
    // decimal or an out-of-range value gets a readable message instead of the
    // opaque one a thrown ZodError produces across the server-action boundary.
    if (next.width.trim() === "" || next.height.trim() === "") {
      toast.error("Enter both a width and a height allowance.");
      return;
    }
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Invalid allowance.");
      return;
    }

    setSavingLine(line);
    startTransition(async () => {
      try {
        await saveManufactureAllowance(parsed.data);
        setSaved((s) => ({ ...s, [line]: next }));
        toast.success(`${LABELS[line]} allowance saved`);
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Save failed");
      } finally {
        setSavingLine(null);
      }
    });
  }

  return (
    <section className="mb-8">
      <div className="mb-3">
        <h2 className="text-base font-semibold text-slate-900">
          Manufacturing allowances
        </h2>
        <p className="text-sm text-slate-600 mt-1 max-w-3xl">
          The manufacturing size is the{" "}
          <span className="font-medium text-slate-900">
            measured opening plus this number
          </span>
          , so a{" "}
          <span className="font-medium text-slate-900">
            negative allowance makes the piece smaller
          </span>{" "}
          than the opening — which is the normal case, a hem down the height and
          clearance across the width. A positive number would make it larger.
          Check the worked example on each row before saving.
        </p>
      </div>

      <div className="bg-white rounded-lg border border-slate-200 overflow-x-auto">
        <table className="w-full text-sm min-w-[44rem]">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Product line</th>
              <th className="text-right px-4 py-3 font-medium">Width</th>
              <th className="text-right px-4 py-3 font-medium">Height</th>
              <th className="text-left px-4 py-3 font-medium">
                A {EXAMPLE.widthCm} × {EXAMPLE.heightCm} cm opening is made at
              </th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => {
              const line = row.productLine;
              const label = LABELS[line];
              const d = draft[line];
              const s = saved[line];
              const dirty = d.width !== s.width || d.height !== s.height;
              const busy = pending && savingLine === line;
              const notSet = s.width === "" && s.height === "";

              const w = Number(d.width);
              const h = Number(d.height);
              const preview =
                d.width.trim() === "" ||
                d.height.trim() === "" ||
                !Number.isFinite(w) ||
                !Number.isFinite(h)
                  ? null
                  : applyAllowance(EXAMPLE, {
                      widthDeltaCm: w,
                      heightDeltaCm: h,
                    });

              return (
                <tr key={line}>
                  <td className="px-4 py-3 align-middle">
                    <div className="font-medium text-slate-900">{label}</div>
                    {notSet ? (
                      <span className="inline-block mt-1 px-2 py-0.5 rounded text-xs font-medium bg-amber-50 text-amber-700">
                        Not set
                      </span>
                    ) : (
                      <div className="mt-1 text-xs text-slate-500 tabular-nums">
                        Saved: {signed(Number(s.width))} cm wide,{" "}
                        {signed(Number(s.height))} cm high
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right align-middle">
                    <label className="inline-flex items-center gap-1">
                      <input
                        aria-label={`${label} width allowance in cm`}
                        inputMode="numeric"
                        placeholder="—"
                        className={CELL_INPUT}
                        value={d.width}
                        onChange={(e) => set(line, "width", e.target.value)}
                      />
                      <span className="text-xs text-slate-400">cm</span>
                    </label>
                  </td>
                  <td className="px-4 py-3 text-right align-middle">
                    <label className="inline-flex items-center gap-1">
                      <input
                        aria-label={`${label} height allowance in cm`}
                        inputMode="numeric"
                        placeholder="—"
                        className={CELL_INPUT}
                        value={d.height}
                        onChange={(e) => set(line, "height", e.target.value)}
                      />
                      <span className="text-xs text-slate-400">cm</span>
                    </label>
                  </td>
                  <td className="px-4 py-3 align-middle text-xs">
                    {preview ? (
                      <span className="text-slate-700 tabular-nums">
                        {signed(preview.mfgWidthCm)} ×{" "}
                        {signed(preview.mfgHeightCm)} cm
                        <span className="text-slate-400">
                          {" "}
                          (
                          {preview.mfgWidthCm < EXAMPLE.widthCm ||
                          preview.mfgHeightCm < EXAMPLE.heightCm
                            ? "smaller than the opening"
                            : preview.mfgWidthCm === EXAMPLE.widthCm &&
                                preview.mfgHeightCm === EXAMPLE.heightCm
                              ? "exactly the opening"
                              : "larger than the opening"}
                          )
                        </span>
                      </span>
                    ) : notSet ? (
                      <span className="text-amber-700">
                        Not set — an order containing{" "}
                        {label.toLowerCase()} cannot be sent to a vendor until
                        this is filled in.
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right align-middle">
                    <Button
                      onClick={() => save(line)}
                      disabled={pending || !dirty}
                      className="bg-teal-600 hover:bg-teal-700 text-white"
                    >
                      {busy ? "Saving…" : "Save"}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
