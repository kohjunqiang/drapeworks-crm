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
  toggleMeshColourActive,
  upsertMeshColour,
} from "@/lib/actions/mesh-catalogue";
import type { MeshColourRow } from "@/lib/db/mesh-catalogue";
import { centsToDisplay } from "@/lib/money";
import {
  meshColourSchema,
  type MeshColourInput,
} from "@/lib/validation/mesh-catalogue";

import { CatalogueSection, RowActions, StatusBadge } from "./catalogue-shell";

const BLANK: MeshColourInput = {
  isNew: true,
  name: "",
  surcharge_rmb: "",
  surcharge_sgd: "",
};

function ColourDialog({
  open,
  onOpenChange,
  defaultValues,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  defaultValues?: Partial<MeshColourInput>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const isEdit = !!defaultValues && defaultValues.isNew === false;

  const form = useForm<MeshColourInput>({
    resolver: zodResolver(meshColourSchema),
    defaultValues: { ...BLANK, ...defaultValues },
  });

  useEffect(() => {
    if (open) form.reset({ ...BLANK, ...defaultValues });
  }, [open, defaultValues, form]);

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      try {
        await upsertMeshColour(values);
        toast.success(isEdit ? "Colour updated" : "Colour added");
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
            {isEdit ? "Edit colour" : "Add mesh colour"}
          </DialogTitle>
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
                    <Input placeholder="e.g. Charcoal" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <p className="text-xs text-slate-500">
              Surcharges are flat per panel, not scaled by size. Leave blank for
              a standard colour.
            </p>

            <div className="grid grid-cols-2 gap-3">
              <FormField
                name="surcharge_rmb"
                control={form.control}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Cost surcharge (¥)</FormLabel>
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
                name="surcharge_sgd"
                control={form.control}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sale surcharge (S$)</FormLabel>
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

export function MeshColoursTable({ colours }: { colours: MeshColourRow[] }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<MeshColourRow | undefined>();
  const [, startTransition] = useTransition();

  function onToggle(c: MeshColourRow) {
    startTransition(async () => {
      try {
        await toggleMeshColourActive(c.id);
        toast.success(
          c.is_active ? `${c.name} archived` : `${c.name} reactivated`,
        );
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Status update failed");
      }
    });
  }

  const editValues: Partial<MeshColourInput> | undefined = editing
    ? {
        isNew: false,
        id: editing.id,
        name: editing.name,
        // centsToDisplay(null) is "0.00", which would turn "no surcharge" into
        // a zero surcharge on save. Keep null as a blank field.
        surcharge_rmb:
          editing.surcharge_rmb_cents == null
            ? ""
            : centsToDisplay(editing.surcharge_rmb_cents),
        surcharge_sgd:
          editing.surcharge_sgd_cents == null
            ? ""
            : centsToDisplay(editing.surcharge_sgd_cents),
      }
    : undefined;

  return (
    <>
      <CatalogueSection
        title="Colours"
        description="One global list, shared by every category. A surcharge is optional."
        addLabel="+ Add colour"
        onAdd={() => {
          setEditing(undefined);
          setOpen(true);
        }}
        isEmpty={colours.length === 0}
        emptyMessage="No colours yet."
      >
        <table className="w-full text-sm min-w-[32rem]">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Name</th>
              <th className="text-right px-4 py-3 font-medium">Cost +¥</th>
              <th className="text-right px-4 py-3 font-medium">Sale +S$</th>
              <th className="text-left px-4 py-3 font-medium w-24">Status</th>
              <th className="text-right px-4 py-3 font-medium w-40">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {colours.map((c) => (
              <tr key={c.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium text-slate-900">
                  {c.name}
                </td>
                <td className="px-4 py-3 text-right text-slate-500">
                  {c.surcharge_rmb_cents == null
                    ? "—"
                    : centsToDisplay(c.surcharge_rmb_cents)}
                </td>
                <td className="px-4 py-3 text-right text-slate-500">
                  {c.surcharge_sgd_cents == null
                    ? "—"
                    : centsToDisplay(c.surcharge_sgd_cents)}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge active={c.is_active} />
                </td>
                <td className="px-4 py-3 text-right">
                  <RowActions
                    active={c.is_active}
                    onEdit={() => {
                      setEditing(c);
                      setOpen(true);
                    }}
                    onToggle={() => onToggle(c)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CatalogueSection>

      <ColourDialog
        open={open}
        onOpenChange={setOpen}
        defaultValues={editValues}
      />
    </>
  );
}
