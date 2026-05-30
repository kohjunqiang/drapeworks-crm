"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { FabricFormDialog } from "./fabric-form-dialog";
import { FabricStatusBadge } from "./fabric-status-badge";
import { FabricSwatch } from "./fabric-swatch";
import { FabricTypeBadge } from "./fabric-type-badge";

import { toggleFabricStatus } from "@/lib/actions/fabrics";
import type { FabricStatus, FabricType } from "@/lib/db/schema";
import type { FabricInput } from "@/lib/validation/fabric";

export type FabricRow = {
  code: string;
  name: string;
  type: FabricType;
  supplier: string | null;
  color: string;
  status: FabricStatus;
  notes: string | null;
};

type Props = {
  fabrics: FabricRow[];
  isAdmin: boolean;
};

export function FabricsTable({ fabrics, isAdmin }: Props) {
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<"" | FabricType>("");
  const [filterStatus, setFilterStatus] = useState<"" | FabricStatus>("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<FabricInput | undefined>(undefined);
  const [, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return fabrics.filter(
      (f) =>
        (!q ||
          f.code.toLowerCase().includes(q) ||
          f.name.toLowerCase().includes(q)) &&
        (!filterType || f.type === filterType) &&
        (!filterStatus || f.status === filterStatus),
    );
  }, [fabrics, search, filterType, filterStatus]);

  function openAdd() {
    setEditing(undefined);
    setDialogOpen(true);
  }

  function openEdit(f: FabricRow) {
    setEditing({
      code: f.code,
      name: f.name,
      type: f.type,
      supplier: f.supplier ?? "",
      color: f.color,
      notes: f.notes ?? "",
      isNew: false,
    });
    setDialogOpen(true);
  }

  function onToggle(f: FabricRow) {
    startTransition(async () => {
      try {
        await toggleFabricStatus(f.code);
        toast.success(
          f.status === "Active"
            ? `${f.code} discontinued`
            : `${f.code} reactivated`,
        );
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Status update failed");
      }
    });
  }

  return (
    <>
      {isAdmin && (
        <div className="flex justify-end mb-3">
          <Button
            onClick={openAdd}
            className="bg-teal-600 hover:bg-teal-700 text-white"
          >
            + Add fabric
          </Button>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-lg border border-slate-200 mb-4 p-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by code or name"
          className="flex-1 px-3 py-2 border border-slate-200 rounded text-sm focus:outline-none focus:border-teal-500"
        />
        <div className="grid grid-cols-2 sm:flex gap-2 sm:gap-3">
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as "" | FabricType)}
            className="px-3 py-2 border border-slate-200 rounded text-sm bg-white"
          >
            <option value="">All types</option>
            <option value="Day">Day</option>
            <option value="Night">Night</option>
            <option value="Both">Both</option>
          </select>
          <select
            value={filterStatus}
            onChange={(e) =>
              setFilterStatus(e.target.value as "" | FabricStatus)
            }
            className="px-3 py-2 border border-slate-200 rounded text-sm bg-white"
          >
            <option value="">All statuses</option>
            <option value="Active">Active</option>
            <option value="Discontinued">Discontinued</option>
          </select>
        </div>
      </div>

      {/* Desktop table */}
      <div className="hidden md:block bg-white rounded-lg border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
            <tr>
              <th className="text-left px-4 py-3 font-medium w-16">Preview</th>
              <th className="text-left px-4 py-3 font-medium">Code</th>
              <th className="text-left px-4 py-3 font-medium">Name</th>
              <th className="text-left px-4 py-3 font-medium">Type</th>
              <th className="text-left px-4 py-3 font-medium">Supplier</th>
              <th className="text-left px-4 py-3 font-medium">Status</th>
              {isAdmin && (
                <th className="text-right px-4 py-3 font-medium">Actions</th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((f) => (
              <tr key={f.code} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <FabricSwatch color={f.color} className="w-10 h-10" />
                </td>
                <td className="px-4 py-3 font-mono text-xs text-slate-700">
                  {f.code}
                </td>
                <td className="px-4 py-3 font-medium text-slate-900">
                  {f.name}
                </td>
                <td className="px-4 py-3">
                  <FabricTypeBadge type={f.type} />
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {f.supplier ?? ""}
                </td>
                <td className="px-4 py-3">
                  <FabricStatusBadge status={f.status} />
                </td>
                {isAdmin && (
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => openEdit(f)}
                      className="text-xs text-slate-600 hover:text-teal-700 mr-3"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => onToggle(f)}
                      className="text-xs text-slate-600 hover:text-red-600"
                    >
                      {f.status === "Active" ? "Discontinue" : "Reactivate"}
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="text-center py-12 text-sm text-slate-500">
            No fabrics match your filters.
          </div>
        )}
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-3">
        {filtered.map((f) => (
          <div
            key={f.code}
            className="bg-white rounded-lg border border-slate-200 p-3 flex items-start gap-3"
          >
            <FabricSwatch color={f.color} className="w-12 h-12 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium text-slate-900 truncate">
                    {f.name}
                  </div>
                  <div className="font-mono text-xs text-slate-500">
                    {f.code}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                  <FabricTypeBadge type={f.type} />
                  <FabricStatusBadge status={f.status} />
                </div>
              </div>
              {f.supplier && (
                <div className="text-xs text-slate-500 mt-1">{f.supplier}</div>
              )}
              {isAdmin && (
                <div className="flex items-center gap-3 mt-2 pt-2 border-t border-slate-100">
                  <button
                    onClick={() => openEdit(f)}
                    className="text-xs text-teal-700 font-medium"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => onToggle(f)}
                    className="text-xs text-slate-600"
                  >
                    {f.status === "Active" ? "Discontinue" : "Reactivate"}
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="text-center py-12 text-sm text-slate-500">
            No fabrics match your filters.
          </div>
        )}
      </div>

      <FabricFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        defaultValues={editing}
      />
    </>
  );
}
