"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { savePoCustomerReference } from "@/lib/actions/procurement";

export function CustomerReferenceInput({ orderId, initialValue }: {
  orderId: string;
  initialValue: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initialValue);
  const [saved, setSaved] = useState(initialValue);
  const [pending, startTransition] = useTransition();

  return (
    <form className="mb-4 rounded-lg border border-slate-200 bg-white p-4 space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          try {
            await savePoCustomerReference(orderId, value);
            setSaved(value);
            toast.success("Customer reference saved. Generate or regenerate the PO to include it.");
            router.refresh();
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "Could not save customer reference.");
          }
        });
      }}>
      <label htmlFor="po-customer-reference" className="text-sm font-medium">
        Customer reference — name and address
      </label>
      <p id="po-customer-reference-help" className="text-xs text-slate-500">
        Printed as CUST REF on this order&apos;s purchase orders. Save before generating.
        Existing PDFs keep their previous reference until regenerated.
        Leave blank to use the customer and order details automatically.
      </p>
      <Textarea id="po-customer-reference" aria-describedby="po-customer-reference-help"
        value={value} onChange={(event) => setValue(event.target.value)}
        rows={3} maxLength={500} disabled={pending}
        placeholder={"Customer name\nStreet address, unit number and postal code"} />
      <Button type="submit" disabled={pending || value === saved}>
        {pending ? "Saving…" : "Save customer reference"}
      </Button>
      {value !== saved && <p className="text-xs text-amber-700">Unsaved changes — save before generating the PO.</p>}
    </form>
  );
}
