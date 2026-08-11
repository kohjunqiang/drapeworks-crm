"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";

import {
  toggleMeshSizeBandActive,
  upsertMeshSizeBand,
} from "@/lib/actions/mesh-catalogue";
import type { MeshSizeBandRow } from "@/lib/db/mesh-catalogue";
import {
  cm2ToSqm,
  meshSizeBandSchema,
  type MeshSizeBandInput,
} from "@/lib/validation/mesh-catalogue";

import { CatalogueSection, RowActions, StatusBadge } from "./catalogue-shell";

const BLANK: MeshSizeBandInput = {
  isNew: true,
  label: "",
  max_area_sqm: "",
};

function BandDialog({
  open,
  onOpenChange,
  defaultValues,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  defaultValues?: Partial<MeshSizeBandInput>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const isEdit = !!defaultValues && defaultValues.isNew === false;

  const form = useForm<MeshSizeBandInput>({
    resolver: zodResolver(meshSizeBandSchema),
    defaultValues: { ...BLANK, ...defaultValues },
  });

  useEffect(() => {
    if (open) form.reset({ ...BLANK, ...defaultValues });
  }, [open, defaultValues, form]);

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      try {
        await upsertMeshSizeBand(values);
        toast.success(isEdit ? "Band updated" : "Band added");
        onOpenChange(false);
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Save failed");
      }
    });
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Edit size band" : "Add size band"}
          </DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={onSubmit} className="space-y-3">
            <FormField
              name="label"
              control={form.control}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Label</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Up to 2 m²" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              name="max_area_sqm"
              control={form.control}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Maximum area (m²)</FormLabel>
                  <FormControl>
                    <Input
                      inputMode="decimal"
                      placeholder="e.g. 2"
                      {...field}
                      value={field.value ?? ""}
                    />
                  </FormControl>
                  <p className="text-xs text-slate-500">
                    Leave blank for the open-ended top band — everything larger
                    than the biggest limit. Only one may be active at a time.
                  </p>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={pending}
                className="bg-teal-600 hover:bg-teal-700 text-white"
              >
                {pending ? "Saving…" : "Save"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export function MeshSizeBandsTable({ bands }: { bands: MeshSizeBandRow[] }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<MeshSizeBandRow | undefined>();
  const [, startTransition] = useTransition();

  const active = bands.filter((b) => b.is_active);
  // Without an open-ended band, a panel larger than every limit resolves to no
  // band at all and prices at zero. The calculator warns per panel; warn the
  // admin here, where it can actually be fixed.
  const hasOpenEnded = active.some((b) => b.max_area_cm2 == null);

  function onToggle(b: MeshSizeBandRow) {
    startTransition(async () => {
      try {
        await toggleMeshSizeBandActive(b.id);
        toast.success(
          b.is_active ? `${b.label} archived` : `${b.label} reactivated`,
        );
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Status update failed");
      }
    });
  }

  const editValues: Partial<MeshSizeBandInput> | undefined = editing
    ? {
        isNew: false,
        id: editing.id,
        label: editing.label,
        max_area_sqm: cm2ToSqm(editing.max_area_cm2),
      }
    : undefined;

  return (
    <>
      {active.length > 0 && !hasOpenEnded && (
        <div className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          No open-ended band. A panel larger than{" "}
          {cm2ToSqm(
            active.reduce((max, b) => Math.max(max, b.max_area_cm2 ?? 0), 0),
          )}{" "}
          m² won&rsquo;t match any band and will price at zero. Add a band with
          a blank maximum.
        </div>
      )}

      <CatalogueSection
        title="Size bands"
        description="Area thresholds that decide the price. Ordered by area — the same order the calculator uses."
        addLabel="+ Add band"
        onAdd={() => {
          setEditing(undefined);
          setOpen(true);
        }}
        isEmpty={bands.length === 0}
        emptyMessage="No size bands yet. Mesh can't be priced until at least one exists."
      >
        <table className="w-full text-sm min-w-[30rem]">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Label</th>
              <th className="text-right px-4 py-3 font-medium">Max area</th>
              <th className="text-left px-4 py-3 font-medium w-24">Status</th>
              <th className="text-right px-4 py-3 font-medium w-40">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {bands.map((b) => (
              <tr key={b.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium text-slate-900">
                  {b.label}
                </td>
                <td className="px-4 py-3 text-right text-slate-500">
                  {b.max_area_cm2 == null ? (
                    <span className="text-slate-400">no limit</span>
                  ) : (
                    `${cm2ToSqm(b.max_area_cm2)} m²`
                  )}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge active={b.is_active} />
                </td>
                <td className="px-4 py-3 text-right">
                  <RowActions
                    active={b.is_active}
                    onEdit={() => {
                      setEditing(b);
                      setOpen(true);
                    }}
                    onToggle={() => onToggle(b)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CatalogueSection>

      <BandDialog
        open={open}
        onOpenChange={setOpen}
        defaultValues={editValues}
      />
    </>
  );
}
