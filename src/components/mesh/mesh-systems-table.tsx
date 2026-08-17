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
  toggleMeshSystemActive,
  upsertMeshSystem,
} from "@/lib/actions/mesh-catalogue";
import type { MeshSystemRow } from "@/lib/db/mesh-catalogue";
import { centsToDisplay } from "@/lib/money";
import { formatMmAsCm } from "@/lib/orders/mesh-system";
import {
  meshSystemSchema,
  mmToCm,
  type MeshSystemInput,
} from "@/lib/validation/mesh-catalogue";

import { CatalogueSection, RowActions, StatusBadge } from "./catalogue-shell";

const BLANK: MeshSystemInput = {
  isNew: true,
  name: "",
  roller_cm: "",
  handle_cm: "",
  side_track_cm: "",
  track_height_cm: "",
  track_depth_cm: "",
  inset_deduction_cm: "",
  double_cost_rmb: "",
  double_sale_sgd: "",
};

const FIELDS = [
  ["roller_cm", "Roller (cm)"],
  ["handle_cm", "Handle (cm)"],
  ["side_track_cm", "Side track (cm)"],
  ["track_height_cm", "Track height (cm)"],
  ["track_depth_cm", "Track depth (cm)"],
  ["inset_deduction_cm", "Inset clearance (cm)"],
] as const;

function SystemDialog({
  open,
  onOpenChange,
  defaultValues,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  defaultValues?: Partial<MeshSystemInput>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const isEdit = !!defaultValues && defaultValues.isNew === false;

  const form = useForm<MeshSystemInput>({
    resolver: zodResolver(meshSystemSchema),
    defaultValues: { ...BLANK, ...defaultValues },
  });

  useEffect(() => {
    if (open) form.reset({ ...BLANK, ...defaultValues });
  }, [open, defaultValues, form]);

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      try {
        await upsertMeshSystem(values);
        toast.success(isEdit ? "System updated" : "System added");
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
          <DialogTitle>{isEdit ? "Edit system" : "Add system"}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={onSubmit} className="space-y-3">
            <FormField
              name="name"
              control={form.control}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. System 68" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <p className="text-xs text-slate-500">
              Must match the name used in the track-system matrix above —
              that&rsquo;s how a panel finds its dimensions.
            </p>

            <div className="grid grid-cols-2 gap-3">
              {FIELDS.map(([name, label]) => (
                <FormField
                  key={name}
                  name={name}
                  control={form.control}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{label}</FormLabel>
                      <FormControl>
                        <Input
                          inputMode="decimal"
                          placeholder="0.0"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ))}
            </div>

            <div className="pt-1">
              <p className="text-xs font-medium text-slate-700">
                Double-draw surcharge
              </p>
              <p className="text-xs text-slate-500 mt-0.5">
                Flat per panel — a double draw carries a second roller and
                handle. Leave blank if there&rsquo;s no extra charge.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <FormField
                name="double_cost_rmb"
                control={form.control}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Cost (¥)</FormLabel>
                    <FormControl>
                      <Input
                        inputMode="decimal"
                        placeholder="0.00"
                        {...field}
                        value={field.value ?? ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                name="double_sale_sgd"
                control={form.control}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sale (S$)</FormLabel>
                    <FormControl>
                      <Input
                        inputMode="decimal"
                        placeholder="0.00"
                        {...field}
                        value={field.value ?? ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

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

export function MeshSystemsTable({ systems }: { systems: MeshSystemRow[] }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<MeshSystemRow | undefined>();
  const [, startTransition] = useTransition();

  function onToggle(s: MeshSystemRow) {
    startTransition(async () => {
      try {
        await toggleMeshSystemActive(s.id);
        toast.success(s.is_active ? `${s.name} archived` : `${s.name} restored`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Status update failed");
      }
    });
  }

  const editValues: Partial<MeshSystemInput> | undefined = editing
    ? {
        isNew: false,
        id: editing.id,
        name: editing.name,
        roller_cm: mmToCm(editing.roller_mm),
        handle_cm: mmToCm(editing.handle_mm),
        side_track_cm: mmToCm(editing.side_track_mm),
        track_height_cm: mmToCm(editing.track_height_mm),
        track_depth_cm: mmToCm(editing.track_depth_mm),
        inset_deduction_cm: mmToCm(editing.inset_deduction_mm),
        double_cost_rmb:
          editing.double_cost_rmb_cents == null
            ? ""
            : centsToDisplay(editing.double_cost_rmb_cents),
        double_sale_sgd:
          editing.double_sale_sgd_cents == null
            ? ""
            : centsToDisplay(editing.double_sale_sgd_cents),
      }
    : undefined;

  return (
    <>
      <CatalogueSection
        title="System dimensions"
        description="What each system physically takes up, and what a double draw adds. A single draw loses one roller + handle plus the side track; a double loses a roller + handle on each leaf and no side track."
        addLabel="+ Add system"
        onAdd={() => {
          setEditing(undefined);
          setOpen(true);
        }}
        isEmpty={systems.length === 0}
        emptyMessage="No systems yet. Without these no track length can be calculated."
      >
        <table className="w-full text-sm min-w-[42rem]">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
            <tr>
              <th className="text-left px-4 py-3 font-medium">System</th>
              <th className="text-right px-4 py-3 font-medium">Roller</th>
              <th className="text-right px-4 py-3 font-medium">Handle</th>
              <th className="text-right px-4 py-3 font-medium">Side track</th>
              <th className="text-right px-4 py-3 font-medium">Track h × d</th>
              <th className="text-right px-4 py-3 font-medium">Inset −</th>
              <th className="text-right px-4 py-3 font-medium">
                Double +¥ / +S$
              </th>
              <th className="text-left px-4 py-3 font-medium w-24">Status</th>
              <th className="text-right px-4 py-3 font-medium w-40">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {systems.map((s) => (
              <tr key={s.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium text-slate-900">
                  {s.name}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                  {formatMmAsCm(s.roller_mm)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                  {formatMmAsCm(s.handle_mm)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                  {formatMmAsCm(s.side_track_mm)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-500">
                  {formatMmAsCm(s.track_height_mm)} ×{" "}
                  {formatMmAsCm(s.track_depth_mm)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-500">
                  {formatMmAsCm(s.inset_deduction_mm)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                  {s.double_cost_rmb_cents == null &&
                  s.double_sale_sgd_cents == null
                    ? "—"
                    : `${
                        s.double_cost_rmb_cents == null
                          ? "—"
                          : centsToDisplay(s.double_cost_rmb_cents)
                      } / ${
                        s.double_sale_sgd_cents == null
                          ? "—"
                          : centsToDisplay(s.double_sale_sgd_cents)
                      }`}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge active={s.is_active} />
                </td>
                <td className="px-4 py-3 text-right">
                  <RowActions
                    active={s.is_active}
                    onEdit={() => {
                      setEditing(s);
                      setOpen(true);
                    }}
                    onToggle={() => onToggle(s)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className="px-4 py-3 text-xs text-slate-500 border-t border-slate-100">
          All in cm. Stored to the millimetre so the track length stays exact —
          a 200 cm single draw on System 68 is 200 − 13.3 − 1.5 = 185.2 cm. The inset clearance comes off on top when the opening has wall to its left and right.
        </p>
      </CatalogueSection>

      <SystemDialog
        open={open}
        onOpenChange={setOpen}
        defaultValues={editValues}
      />
    </>
  );
}
