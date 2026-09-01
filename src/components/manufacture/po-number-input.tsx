"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  assignNextOrderReference,
  setOrderReference,
} from "@/lib/actions/orders";

export function PoNumberInput({ orderId, initialValue, suggestedValue }: {
  orderId: string;
  initialValue: string | null;
  suggestedValue: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initialValue ?? suggestedValue);
  const [saved, setSaved] = useState(initialValue ?? "");
  const [edited, setEdited] = useState(false);
  const [pending, startTransition] = useTransition();
  const assignmentStarted = useRef(false);

  useEffect(() => {
    if (initialValue || assignmentStarted.current) return;
    assignmentStarted.current = true;
    startTransition(async () => {
      try {
        const assigned = await assignNextOrderReference(orderId);
        setValue(assigned);
        setSaved(assigned);
        setEdited(false);
        router.refresh();
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Could not assign the next PO number.",
        );
      }
    });
  }, [initialValue, orderId, router]);

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
            setEdited(false);
            toast.success("PO number saved. Generate or regenerate the PO to include it.");
            router.refresh();
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "Could not save PO number.");
          }
        });
      }}>
      <label htmlFor="po-number" className="text-sm font-medium">PO number</label>
      <p id="po-number-help" className="text-xs text-slate-500">
        {initialValue
          ? "This is also the order reference. Existing PDFs keep their number until regenerated."
          : pending
            ? "Assigning and saving the next available running number…"
            : "The next available running number is assigned automatically. Edit and save only if it needs to change."}
      </p>
      <div className="flex items-center gap-2">
        <Input id="po-number" aria-describedby="po-number-help" type="text"
          value={value} onChange={(event) => {
            setValue(event.target.value);
            setEdited(event.target.value.trim() !== saved);
          }}
          maxLength={64} required disabled={pending} className="flex-1" />
        <Button type="submit" className="shrink-0"
          disabled={pending || !value.trim() || !edited}>
          {pending ? "Saving…" : "Save PO number"}
        </Button>
      </div>
      {!pending && edited && <p className="text-xs text-amber-700">Unsaved changes — save before generating the PO.</p>}
    </form>
  );
}
