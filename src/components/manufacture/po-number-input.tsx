"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setOrderReference } from "@/lib/actions/orders";

export function PoNumberInput({ orderId, initialValue }: {
  orderId: string;
  initialValue: string | null;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initialValue ?? "");
  const [saved, setSaved] = useState(initialValue ?? "");
  const [pending, startTransition] = useTransition();

  return (
    <form className="mb-4 rounded-lg border border-slate-200 bg-white p-4 space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        const number = value.trim();
        if (!number) return;
        startTransition(async () => {
          try {
            await setOrderReference({ orderId, reference: number });
            setValue(number);
            setSaved(number);
            toast.success("PO number saved. Generate or regenerate the PO to include it.");
            router.refresh();
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "Could not save PO number.");
          }
        });
      }}>
      <label htmlFor="po-number" className="text-sm font-medium">PO number</label>
      <p id="po-number-help" className="text-xs text-slate-500">
        Enter your running number manually and save before generating. This is also the
        order reference. Existing PDFs keep their number until regenerated.
      </p>
      <Input id="po-number" aria-describedby="po-number-help" type="text"
        value={value} onChange={(event) => setValue(event.target.value)}
        maxLength={64} required disabled={pending} placeholder="10052" />
      <Button type="submit" disabled={pending || !value.trim() || value.trim() === saved}>
        {pending ? "Saving…" : "Save PO number"}
      </Button>
      {value !== saved && <p className="text-xs text-amber-700">Unsaved changes — save before generating the PO.</p>}
    </form>
  );
}
