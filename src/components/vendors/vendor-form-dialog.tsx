"use client";

import { useEffect, useTransition } from "react";
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

import { upsertVendor } from "@/lib/actions/vendors";
import { vendorSchema, type VendorInput } from "@/lib/validation/vendor";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultValues?: Partial<VendorInput>;
};

const BLANK: VendorInput = {
  isNew: true,
  name: "",
  notes: undefined,
  internal_ref: undefined,
  name_cn: undefined,
  address_cn: undefined,
  phone: undefined,
};

export function VendorFormDialog({ open, onOpenChange, defaultValues }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const isEdit = !!defaultValues && defaultValues.isNew === false;

  const form = useForm<VendorInput>({
    resolver: zodResolver(vendorSchema),
    defaultValues: { ...BLANK, ...defaultValues },
  });

  // Reset when the dialog re-opens with different defaults (Add ⇄ Edit).
  useEffect(() => {
    if (open) form.reset({ ...BLANK, ...defaultValues });
  }, [open, defaultValues, form]);

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      try {
        await upsertVendor(values);
        toast.success(isEdit ? "Vendor updated" : "Vendor added");
        onOpenChange(false);
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Save failed");
      }
    });
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Eight fields now, so the dialog scrolls rather than running off a
          phone screen. */}
      <DialogContent className="sm:max-w-md max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit vendor" : "Add vendor"}</DialogTitle>
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
                    <Input placeholder="e.g. Rising" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              name="notes"
              control={form.control}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes (optional)</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="e.g. Blinds specialist, 3-day lead time"
                      {...field}
                      value={field.value ?? ""}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/*
              The 供应商 block of a purchase order. Every field is optional and
              none of them blocks generation — a vendor with no phone number
              prints one line fewer. They are contact details, not cutting
              instructions, which is why they sit here rather than on the
              Procurement screen where a missing value stops a document.
            */}
            <div className="pt-2 border-t border-slate-100">
              <p className="text-xs font-medium text-slate-700">
                Purchase order details
              </p>
              <p className="text-xs text-slate-500 mt-0.5">
                Printed in the 供应商 block. All optional — a blank line is
                omitted from the document, never printed empty.
              </p>
            </div>

            <FormField
              name="internal_ref"
              control={form.control}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Internal ref (optional)</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="e.g. V005"
                      {...field}
                      value={field.value ?? ""}
                    />
                  </FormControl>
                  <p className="text-xs text-slate-500">
                    The V005-style code printed on the PO as
                    &ldquo;Internal Ref&rdquo;.
                  </p>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              name="name_cn"
              control={form.control}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Chinese name — 中文 (optional)</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="e.g. 顺金纺织窗材有限公司"
                      {...field}
                      value={field.value ?? ""}
                    />
                  </FormControl>
                  <p className="text-xs text-slate-500">
                    Printed above the Latin name. Left blank, only the Latin
                    name prints.
                  </p>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              name="address_cn"
              control={form.control}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Chinese address — 中文 (optional)</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="e.g. 北联 2 楼 2348 室"
                      {...field}
                      value={field.value ?? ""}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              name="phone"
              control={form.control}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Phone — 电话 (optional)</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="e.g. 13750954207"
                      {...field}
                      value={field.value ?? ""}
                    />
                  </FormControl>
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
