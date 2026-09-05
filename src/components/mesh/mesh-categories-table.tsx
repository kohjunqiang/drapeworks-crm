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
  toggleMeshCategoryActive,
  upsertMeshCategory,
} from "@/lib/actions/mesh-catalogue";
import type { MeshCategoryRow } from "@/lib/db/mesh-catalogue";
import {
  meshCategorySchema,
  type MeshCategoryInput,
} from "@/lib/validation/mesh-catalogue";

import { centsToDisplay } from "@/lib/money";

import { CatalogueSection, RowActions, StatusBadge } from "./catalogue-shell";

type VendorOption = { id: string; name: string };

const BLANK: MeshCategoryInput = {
  isNew: true,
  name: "",
  description: undefined,
  vendor_id: undefined,
  cost_rmb_per_sqm: "",
  sale_sgd_per_sqm: "",
};

// centsToDisplay(null) is "0.00", which would turn "not priced" into a zero
// rate on save. Keep null as a blank field.
const rateField = (cents: number | null): string =>
  cents == null ? "" : centsToDisplay(cents);

function CategoryDialog({
  open,
  onOpenChange,
  defaultValues,
  vendors,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  defaultValues?: Partial<MeshCategoryInput>;
  vendors: VendorOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const isEdit = !!defaultValues && defaultValues.isNew === false;

  const form = useForm<MeshCategoryInput>({
    resolver: zodResolver(meshCategorySchema),
    defaultValues: { ...BLANK, ...defaultValues },
  });

  useEffect(() => {
    if (open) form.reset({ ...BLANK, ...defaultValues });
  }, [open, defaultValues, form]);

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      try {
        await upsertMeshCategory(values);
        toast.success(isEdit ? "Category updated" : "Category added");
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
            {isEdit ? "Edit category" : "Add mesh category"}
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
                    <Input placeholder="e.g. AirGuard" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              name="description"
              control={form.control}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description (optional)</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="e.g. Insect mesh"
                      {...field}
                      value={field.value ?? ""}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              name="vendor_id"
              control={form.control}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Vendor (optional)</FormLabel>
                  <FormControl>
                    <select
                      {...field}
                      value={field.value ?? ""}
                      className="w-full px-2.5 py-2 border border-slate-200 rounded text-sm focus:outline-none focus:border-teal-500 bg-white"
                    >
                      <option value="">— none —</option>
                      {vendors.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name}
                        </option>
                      ))}
                    </select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="pt-1">
              <p className="text-xs font-medium text-slate-700">
                Rate per square metre
              </p>
              <p className="text-xs text-slate-500 mt-0.5">
                Each panel&rsquo;s billable area is rounded up to 0.1 m², then
                multiplied by these rates. Leave blank until you know the rate.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <FormField
                name="cost_rmb_per_sqm"
                control={form.control}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Cost (¥/m²)</FormLabel>
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
                name="sale_sgd_per_sqm"
                control={form.control}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sale (S$/m²)</FormLabel>
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

export function MeshCategoriesTable({
  categories,
  vendors,
}: {
  categories: MeshCategoryRow[];
  vendors: VendorOption[];
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<MeshCategoryRow | undefined>();
  const [, startTransition] = useTransition();

  function onToggle(c: MeshCategoryRow) {
    startTransition(async () => {
      try {
        await toggleMeshCategoryActive(c.id);
        toast.success(
          c.is_active ? `${c.name} archived` : `${c.name} reactivated`,
        );
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Status update failed");
      }
    });
  }

  const editValues: Partial<MeshCategoryInput> | undefined = editing
    ? {
        isNew: false,
        id: editing.id,
        name: editing.name,
        description: editing.description ?? undefined,
        vendor_id: editing.vendor_id ?? undefined,
        cost_rmb_per_sqm: rateField(editing.cost_rmb_cents_per_sqm),
        sale_sgd_per_sqm: rateField(editing.sale_sgd_cents_per_sqm),
      }
    : undefined;

  return (
    <>
      <CatalogueSection
        title="Categories"
        description="The mesh grades you sell, each with its per-square-metre rate — e.g. AirGuard, PetGuard, MaxGuard."
        addLabel="+ Add category"
        onAdd={() => {
          setEditing(undefined);
          setOpen(true);
        }}
        isEmpty={categories.length === 0}
        emptyMessage="No categories yet. Add your first one to start pricing mesh."
      >
        <table className="w-full text-sm min-w-[36rem]">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Name</th>
              <th className="text-left px-4 py-3 font-medium">Description</th>
              <th className="text-left px-4 py-3 font-medium">Vendor</th>
              <th className="text-right px-4 py-3 font-medium">Cost ¥/m²</th>
              <th className="text-right px-4 py-3 font-medium">Sale S$/m²</th>
              <th className="text-left px-4 py-3 font-medium w-24">Status</th>
              <th className="text-right px-4 py-3 font-medium w-40">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {categories.map((c) => (
              <tr key={c.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium text-slate-900">
                  {c.name}
                </td>
                <td className="px-4 py-3 text-slate-500">
                  {c.description ?? "—"}
                </td>
                <td className="px-4 py-3 text-slate-500">
                  {c.vendor_name ?? "—"}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {c.cost_rmb_cents_per_sqm == null ? (
                    // A sale with no cost prices the customer correctly but
                    // reports a margin near 100% — flag it here, where it can
                    // be fixed, since the below-floor guard can never catch it.
                    <span
                      className={
                        c.sale_sgd_cents_per_sqm == null
                          ? "text-slate-400"
                          : "text-amber-700"
                      }
                      title={
                        c.sale_sgd_cents_per_sqm == null
                          ? undefined
                          : "No cost rate — margin on this category is unreliable"
                      }
                    >
                      —
                    </span>
                  ) : (
                    <span className="text-slate-700">
                      {centsToDisplay(c.cost_rmb_cents_per_sqm)}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {c.sale_sgd_cents_per_sqm == null ? (
                    <span className="text-slate-400">not priced</span>
                  ) : (
                    <span className="font-medium text-slate-900">
                      {centsToDisplay(c.sale_sgd_cents_per_sqm)}
                    </span>
                  )}
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

      <CategoryDialog
        open={open}
        onOpenChange={setOpen}
        defaultValues={editValues}
        vendors={vendors}
      />
    </>
  );
}
