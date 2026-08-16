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
  toggleMeshSystemBandActive,
  upsertMeshSystemBand,
} from "@/lib/actions/mesh-catalogue";
import type { MeshSystemBandRow } from "@/lib/db/mesh-catalogue";
import {
  meshSystemBandSchema,
  type MeshSystemBandInput,
} from "@/lib/validation/mesh-catalogue";

import { CatalogueSection, RowActions, StatusBadge } from "./catalogue-shell";

const BLANK: MeshSystemBandInput = {
  isNew: true,
  max_width_cm: "",
  single_system: "",
  double_system: "",
};

const NOT_POSSIBLE = (
  <span className="text-slate-400 italic">not possible</span>
);

function BandDialog({
  open,
  onOpenChange,
  defaultValues,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  defaultValues?: Partial<MeshSystemBandInput>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const isEdit = !!defaultValues && defaultValues.isNew === false;

  const form = useForm<MeshSystemBandInput>({
    resolver: zodResolver(meshSystemBandSchema),
    defaultValues: { ...BLANK, ...defaultValues },
  });

  useEffect(() => {
    if (open) form.reset({ ...BLANK, ...defaultValues });
  }, [open, defaultValues, form]);

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      try {
        await upsertMeshSystemBand(values);
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
          <DialogTitle>{isEdit ? "Edit band" : "Add width band"}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={onSubmit} className="space-y-3">
            <FormField
              name="max_width_cm"
              control={form.control}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Up to width (cm)</FormLabel>
                  <FormControl>
                    <Input
                      inputMode="numeric"
                      placeholder="e.g. 250"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <p className="text-xs text-slate-500">
              Inclusive. A panel uses the narrowest band it fits in. Leave a
              system blank when that draw isn&rsquo;t possible at this width.
            </p>

            <div className="grid grid-cols-2 gap-3">
              <FormField
                name="single_system"
                control={form.control}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Single draw</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g. System 68"
                        {...field}
                        value={field.value ?? ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                name="double_system"
                control={form.control}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Double draw</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g. System 55"
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

export function MeshSystemBandsTable({ bands }: { bands: MeshSystemBandRow[] }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<MeshSystemBandRow | undefined>();
  const [, startTransition] = useTransition();

  function onToggle(b: MeshSystemBandRow) {
    startTransition(async () => {
      try {
        await toggleMeshSystemBandActive(b.id);
        toast.success(b.is_active ? "Band archived" : "Band reactivated");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Status update failed");
      }
    });
  }

  const editValues: Partial<MeshSystemBandInput> | undefined = editing
    ? {
        isNew: false,
        id: editing.id,
        max_width_cm: String(editing.max_width_cm),
        single_system: editing.single_system ?? "",
        double_system: editing.double_system ?? "",
      }
    : undefined;

  return (
    <>
      <CatalogueSection
        title="Track systems"
        description="Which system a panel needs, by total window width and draw. A double draw splits the span across two leaves, so it can use a lighter system than a single draw of the same width."
        addLabel="+ Add width band"
        onAdd={() => {
          setEditing(undefined);
          setOpen(true);
        }}
        isEmpty={bands.length === 0}
        emptyMessage="No width bands yet. Without them no panel can resolve a system."
      >
        <table className="w-full text-sm min-w-[36rem]">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
            <tr>
              <th className="text-left px-4 py-3 font-medium">
                Total window width
              </th>
              <th className="text-left px-4 py-3 font-medium">
                If single draw
              </th>
              <th className="text-left px-4 py-3 font-medium">
                If double draw
              </th>
              <th className="text-left px-4 py-3 font-medium w-24">Status</th>
              <th className="text-right px-4 py-3 font-medium w-40">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {bands.map((b, i) => {
              // The lower bound is implied by the previous active band, which
              // is how the printed cheat sheet reads. Archived rows don't
              // participate in resolution, so they don't shift it either.
              const prev = bands
                .slice(0, i)
                .filter((x) => x.is_active)
                .at(-1);
              const from = b.is_active && prev ? prev.max_width_cm + 1 : null;

              return (
                <tr key={b.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900 tabular-nums">
                    {from ? `${from} – ` : "up to "}
                    {b.max_width_cm} cm
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {b.single_system ?? NOT_POSSIBLE}
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {b.double_system ?? NOT_POSSIBLE}
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
              );
            })}
          </tbody>
        </table>

        <p className="px-4 py-3 text-xs text-slate-500 border-t border-slate-100">
          Anything wider than the last band is not buildable, and the
          consultation form refuses to save it. There is deliberately no
          open-ended band — a panel too wide to build must be an error, not the
          heaviest system by default.
        </p>
      </CatalogueSection>

      <BandDialog
        open={open}
        onOpenChange={setOpen}
        defaultValues={editValues}
      />
    </>
  );
}
