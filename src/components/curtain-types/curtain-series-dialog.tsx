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
  toggleCurtainSeriesActive,
  upsertCurtainSeries,
} from "@/lib/actions/curtain-series";
import type { CurtainSeriesRow } from "@/lib/db/curtain-types";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  series: CurtainSeriesRow[];
};

function SeriesRow({ row }: { row: CurtainSeriesRow }) {
  const router = useRouter();
  const [name, setName] = useState(row.name);
  const [pending, startTransition] = useTransition();
  const dirty = name.trim() !== row.name && name.trim().length > 0;

  function rename() {
    startTransition(async () => {
      try {
        await upsertCurtainSeries({ isNew: false, id: row.id, name: name.trim() });
        toast.success("Series renamed");
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Rename failed");
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
    <div className="flex items-center gap-2 py-2 border-b border-slate-100 last:border-0">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        className={row.is_active ? "" : "text-slate-400"}
      />
      <span className="text-xs text-slate-400 w-14 text-right flex-shrink-0">
        {row.typeCount} {row.typeCount === 1 ? "type" : "types"}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={!dirty || pending}
        onClick={rename}
      >
        Save
      </Button>
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        className="text-xs text-slate-500 hover:text-red-600 w-20 text-right flex-shrink-0"
      >
        {row.is_active ? "Archive" : "Reactivate"}
      </button>
    </div>
  );
}

export function CurtainSeriesDialog({ open, onOpenChange, series }: Props) {
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
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Manage series</DialogTitle>
        </DialogHeader>

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

        <div className="mt-2 max-h-80 overflow-y-auto">
          {series.length === 0 ? (
            <p className="text-sm text-slate-500 py-6 text-center">
              No series yet. Add your first one above.
            </p>
          ) : (
            series.map((s) => <SeriesRow key={s.id} row={s} />)
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
