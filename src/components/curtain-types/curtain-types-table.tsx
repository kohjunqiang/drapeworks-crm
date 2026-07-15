"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { CurtainSeriesDialog } from "./curtain-series-dialog";
import { CurtainTypeFormDialog } from "./curtain-type-form-dialog";

import { toggleCurtainTypeStatus } from "@/lib/actions/curtain-types";
import type { CurtainSeriesRow } from "@/lib/db/curtain-types";
import type { VendorOption } from "@/lib/db/vendors";
import type { CurtainCategory, CurtainTypeStatus } from "@/lib/db/schema";
import type { CurtainTypeInput } from "@/lib/validation/curtain-type";

export type CurtainTypeRow = {
  id: string;
  label: string;
  category: CurtainCategory;
  status: CurtainTypeStatus;
  photo_path: string | null;
  photoUrl: string | null;
  series_id: string | null;
  series_name: string | null;
  series_index: number | null;
  page: string | null;
  // Pricing inherited from the series (read-only here).
  vendor_name: string | null;
  cost_rmb: string | null;
  sale_sgd: string | null;
};

type Props = {
  curtainTypes: CurtainTypeRow[];
  series: CurtainSeriesRow[];
  vendors: VendorOption[];
};

function Thumb({
  url,
  label,
  onOpen,
}: {
  url: string | null;
  label: string;
  onOpen?: () => void;
}) {
  const base =
    "w-12 h-12 rounded border border-slate-200 bg-slate-100 overflow-hidden flex items-center justify-center flex-shrink-0";
  if (!url) {
    return (
      <div className={base}>
        <span className="text-[9px] text-slate-400">No photo</span>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      title="Click to enlarge"
      className={`${base} cursor-zoom-in transition hover:ring-2 hover:ring-teal-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={label} className="w-full h-full object-cover" />
    </button>
  );
}

function CategoryBadge({ category }: { category: CurtainCategory }) {
  const cls =
    category === "Day"
      ? "bg-amber-50 text-amber-700"
      : "bg-indigo-50 text-indigo-700";
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
      {category}
    </span>
  );
}

function StatusBadge({ status }: { status: CurtainTypeStatus }) {
  const cls =
    status === "Active"
      ? "bg-teal-50 text-teal-700"
      : "bg-slate-100 text-slate-500";
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
      {status}
    </span>
  );
}

export function CurtainTypesTable({ curtainTypes, series, vendors }: Props) {
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState<"" | CurtainCategory>("");
  const [filterStatus, setFilterStatus] = useState<"" | CurtainTypeStatus>("");
  const [filterSeries, setFilterSeries] = useState<string>("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [seriesDialogOpen, setSeriesDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CurtainTypeRow | undefined>(undefined);
  const [lightbox, setLightbox] = useState<
    { url: string; label: string } | null
  >(null);
  const [, startTransition] = useTransition();

  function openPhoto(c: CurtainTypeRow) {
    if (c.photoUrl) setLightbox({ url: c.photoUrl, label: c.label });
  }

  // Only active series can be assigned to a curtain type.
  const activeSeries = useMemo(
    () => series.filter((s) => s.is_active).map((s) => ({ id: s.id, name: s.name })),
    [series],
  );

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return curtainTypes.filter(
      (c) =>
        (!q || c.label.toLowerCase().includes(q)) &&
        (!filterCategory || c.category === filterCategory) &&
        (!filterStatus || c.status === filterStatus) &&
        (!filterSeries || c.series_id === filterSeries),
    );
  }, [curtainTypes, search, filterCategory, filterStatus, filterSeries]);

  function openAdd() {
    setEditing(undefined);
    setDialogOpen(true);
  }

  function openEdit(c: CurtainTypeRow) {
    setEditing(c);
    setDialogOpen(true);
  }

  function onToggle(c: CurtainTypeRow) {
    startTransition(async () => {
      try {
        await toggleCurtainTypeStatus(c.id);
        toast.success(
          c.status === "Active"
            ? `${c.label} archived`
            : `${c.label} reactivated`,
        );
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Status update failed");
      }
    });
  }

  const editValues: Partial<CurtainTypeInput> | undefined = editing
    ? {
        isNew: false,
        id: editing.id,
        label: editing.label,
        category: editing.category,
        series_id: editing.series_id ?? "",
        page: editing.page ?? undefined,
        photo_path: editing.photo_path ?? undefined,
      }
    : undefined;

  return (
    <>
      <div className="flex justify-end gap-2 mb-3">
        <Button
          variant="outline"
          onClick={() => setSeriesDialogOpen(true)}
        >
          Manage series
        </Button>
        <Button
          onClick={openAdd}
          className="bg-teal-600 hover:bg-teal-700 text-white"
        >
          + Add curtain type
        </Button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg border border-slate-200 mb-4 p-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by label"
          className="flex-1 px-3 py-2 border border-slate-200 rounded text-sm focus:outline-none focus:border-teal-500"
        />
        <div className="grid grid-cols-2 sm:flex gap-2 sm:gap-3">
          <select
            value={filterSeries}
            onChange={(e) => setFilterSeries(e.target.value)}
            className="px-3 py-2 border border-slate-200 rounded text-sm bg-white"
          >
            <option value="">All series</option>
            {series.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.is_active ? "" : " (archived)"}
              </option>
            ))}
          </select>
          <select
            value={filterCategory}
            onChange={(e) =>
              setFilterCategory(e.target.value as "" | CurtainCategory)
            }
            className="px-3 py-2 border border-slate-200 rounded text-sm bg-white"
          >
            <option value="">All categories</option>
            <option value="Day">Day</option>
            <option value="Night">Night</option>
          </select>
          <select
            value={filterStatus}
            onChange={(e) =>
              setFilterStatus(e.target.value as "" | CurtainTypeStatus)
            }
            className="px-3 py-2 border border-slate-200 rounded text-sm bg-white"
          >
            <option value="">All statuses</option>
            <option value="Active">Active</option>
            <option value="Archived">Archived</option>
          </select>
        </div>
      </div>

      {/* Desktop table */}
      <div className="hidden md:block bg-white rounded-lg border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
            <tr>
              <th className="text-left px-4 py-3 font-medium w-16">Photo</th>
              <th className="text-left px-4 py-3 font-medium">Label</th>
              <th className="text-left px-4 py-3 font-medium">Series</th>
              <th className="text-left px-4 py-3 font-medium w-12">#</th>
              <th className="text-left px-4 py-3 font-medium">Page</th>
              <th className="text-left px-4 py-3 font-medium">
                Vendor / Price
                <span className="font-normal text-slate-400"> (series)</span>
              </th>
              <th className="text-left px-4 py-3 font-medium">Category</th>
              <th className="text-left px-4 py-3 font-medium">Status</th>
              <th className="text-right px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((c) => (
              <tr key={c.id} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <Thumb
                    url={c.photoUrl}
                    label={c.label}
                    onOpen={() => openPhoto(c)}
                  />
                </td>
                <td className="px-4 py-3 font-medium text-slate-900">
                  {c.label}
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {c.series_name ?? "—"}
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {c.series_index ?? "—"}
                </td>
                <td className="px-4 py-3 text-slate-600">{c.page ?? "—"}</td>
                <td className="px-4 py-3">
                  {c.vendor_name || c.cost_rmb || c.sale_sgd ? (
                    <div className="text-xs">
                      <div className="text-slate-700 font-medium">
                        {c.vendor_name ?? "—"}
                      </div>
                      <div className="text-slate-400">
                        {c.cost_rmb ? `¥${c.cost_rmb}` : "—"} →{" "}
                        {c.sale_sgd ? `S$${c.sale_sgd}` : "—"}
                      </div>
                    </div>
                  ) : (
                    <span className="text-slate-400 text-xs">Not priced</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <CategoryBadge category={c.category} />
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={c.status} />
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => openEdit(c)}
                    className="text-xs text-slate-600 hover:text-teal-700 mr-3"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => onToggle(c)}
                    className="text-xs text-slate-600 hover:text-red-600"
                  >
                    {c.status === "Active" ? "Archive" : "Reactivate"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="text-center py-12 text-sm text-slate-500">
            No curtain types match your filters.
          </div>
        )}
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-3">
        {filtered.map((c) => (
          <div
            key={c.id}
            className="bg-white rounded-lg border border-slate-200 p-3 flex items-start gap-3"
          >
            <Thumb
              url={c.photoUrl}
              label={c.label}
              onOpen={() => openPhoto(c)}
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium text-slate-900 truncate">
                    {c.label}
                  </div>
                  <div className="text-xs text-slate-500">
                    {c.series_name ?? "No series"}
                    {c.series_index != null ? ` · #${c.series_index}` : ""}
                    {c.page ? ` · ${c.page}` : ""}
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    {c.vendor_name || c.cost_rmb || c.sale_sgd
                      ? `${c.vendor_name ?? "—"} · ${c.cost_rmb ? `¥${c.cost_rmb}` : "—"} → ${c.sale_sgd ? `S$${c.sale_sgd}` : "—"}`
                      : "Not priced"}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                  <CategoryBadge category={c.category} />
                  <StatusBadge status={c.status} />
                </div>
              </div>
              <div className="flex items-center gap-3 mt-2 pt-2 border-t border-slate-100">
                <button
                  onClick={() => openEdit(c)}
                  className="text-xs text-teal-700 font-medium"
                >
                  Edit
                </button>
                <button
                  onClick={() => onToggle(c)}
                  className="text-xs text-slate-600"
                >
                  {c.status === "Active" ? "Archive" : "Reactivate"}
                </button>
              </div>
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="text-center py-12 text-sm text-slate-500">
            No curtain types match your filters.
          </div>
        )}
      </div>

      <CurtainTypeFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        series={activeSeries}
        defaultValues={editValues}
        photoUrl={editing?.photoUrl}
        seriesIndex={editing?.series_index}
      />
      <CurtainSeriesDialog
        open={seriesDialogOpen}
        onOpenChange={setSeriesDialogOpen}
        series={series}
        vendors={vendors}
      />

      {/* Photo lightbox */}
      <Dialog
        open={!!lightbox}
        onOpenChange={(open) => {
          if (!open) setLightbox(null);
        }}
      >
        <DialogContent className="w-auto max-w-[95vw] sm:max-w-2xl p-0 overflow-hidden">
          <DialogTitle className="px-4 py-3 text-sm font-medium text-slate-900 border-b border-slate-200">
            {lightbox?.label}
          </DialogTitle>
          {lightbox && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={lightbox.url}
              alt={lightbox.label}
              className="block max-w-full max-h-[80vh] w-auto h-auto object-contain bg-slate-100"
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
