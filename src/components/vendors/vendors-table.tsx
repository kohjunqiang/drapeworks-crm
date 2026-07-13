"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { VendorFormDialog } from "./vendor-form-dialog";

import { toggleVendorActive } from "@/lib/actions/vendors";
import type { VendorRow } from "@/lib/db/vendors";
import type { VendorInput } from "@/lib/validation/vendor";

type Props = {
  vendors: VendorRow[];
};

function StatusBadge({ active }: { active: boolean }) {
  const cls = active
    ? "bg-teal-50 text-teal-700"
    : "bg-slate-100 text-slate-500";
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
      {active ? "Active" : "Archived"}
    </span>
  );
}

export function VendorsTable({ vendors }: Props) {
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<VendorRow | undefined>(undefined);
  const [, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return vendors;
    return vendors.filter((v) => v.name.toLowerCase().includes(q));
  }, [vendors, search]);

  function openAdd() {
    setEditing(undefined);
    setDialogOpen(true);
  }

  function openEdit(v: VendorRow) {
    setEditing(v);
    setDialogOpen(true);
  }

  function onToggle(v: VendorRow) {
    startTransition(async () => {
      try {
        await toggleVendorActive(v.id);
        toast.success(
          v.is_active ? `${v.name} archived` : `${v.name} reactivated`,
        );
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Status update failed");
      }
    });
  }

  const editValues: Partial<VendorInput> | undefined = editing
    ? {
        isNew: false,
        id: editing.id,
        name: editing.name,
        notes: editing.notes ?? undefined,
      }
    : undefined;

  return (
    <>
      <div className="flex justify-end mb-3">
        <Button
          onClick={openAdd}
          className="bg-teal-600 hover:bg-teal-700 text-white"
        >
          + Add vendor
        </Button>
      </div>

      <div className="bg-white rounded-lg border border-slate-200 mb-4 p-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name"
          className="w-full px-3 py-2 border border-slate-200 rounded text-sm focus:outline-none focus:border-teal-500"
        />
      </div>

      {/* Desktop table */}
      <div className="hidden md:block bg-white rounded-lg border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Name</th>
              <th className="text-left px-4 py-3 font-medium">Notes</th>
              <th className="text-left px-4 py-3 font-medium w-24">Status</th>
              <th className="text-right px-4 py-3 font-medium w-40">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((v) => (
              <tr key={v.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium text-slate-900">
                  {v.name}
                </td>
                <td className="px-4 py-3 text-slate-500">{v.notes ?? "—"}</td>
                <td className="px-4 py-3">
                  <StatusBadge active={v.is_active} />
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => openEdit(v)}
                    className="text-xs text-slate-600 hover:text-teal-700 mr-3"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => onToggle(v)}
                    className="text-xs text-slate-600 hover:text-red-600"
                  >
                    {v.is_active ? "Archive" : "Reactivate"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="text-center py-12 text-sm text-slate-500">
            {vendors.length === 0
              ? "No vendors yet. Add your first one."
              : "No vendors match your search."}
          </div>
        )}
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-3">
        {filtered.map((v) => (
          <div
            key={v.id}
            className="bg-white rounded-lg border border-slate-200 p-3"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-medium text-slate-900">{v.name}</div>
                {v.notes && (
                  <div className="text-xs text-slate-500 mt-0.5">{v.notes}</div>
                )}
              </div>
              <StatusBadge active={v.is_active} />
            </div>
            <div className="flex items-center gap-3 mt-2 pt-2 border-t border-slate-100">
              <button
                onClick={() => openEdit(v)}
                className="text-xs text-teal-700 font-medium"
              >
                Edit
              </button>
              <button
                onClick={() => onToggle(v)}
                className="text-xs text-slate-600"
              >
                {v.is_active ? "Archive" : "Reactivate"}
              </button>
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="text-center py-12 text-sm text-slate-500">
            {vendors.length === 0
              ? "No vendors yet. Add your first one."
              : "No vendors match your search."}
          </div>
        )}
      </div>

      <VendorFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        defaultValues={editValues}
      />
    </>
  );
}
