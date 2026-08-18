"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { setOrderReference } from "@/lib/actions/orders";

type Props = {
  orderId: string;
  reference: string | null;
  canEdit: boolean;
};

// The vendor/delivery-facing identifier. Read-only text for anyone who cannot
// edit it, an inline input for ops and admin. Kept deliberately small — this is
// one field on a page that is otherwise a read surface.
export function OrderReferenceField({ orderId, reference, canEdit }: Props) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(reference ?? "");
  const [pending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      try {
        await setOrderReference({ orderId, reference: value });
        toast.success("Order reference saved");
        setEditing(false);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not save reference");
      }
    });
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-slate-800">
          {reference || <span className="text-slate-400">Not set</span>}
        </span>
        {canEdit && (
          <button
            type="button"
            onClick={() => {
              // The server action trims/normalises on save and revalidates
              // this route, so `reference` is always the canonical value by
              // the time it re-renders. Re-seeding `value` here (rather than
              // only at mount) keeps a reopened editor from showing whatever
              // untrimmed text the user typed last time instead of what's
              // actually stored.
              setValue(reference ?? "");
              setEditing(true);
            }}
            className="text-xs text-teal-700 hover:text-teal-800 underline"
          >
            {reference ? "Change" : "Set"}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <input
        type="text"
        value={value}
        maxLength={64}
        onChange={(e) => setValue(e.target.value)}
        placeholder="e.g. SJ-2026-118"
        // The visible "Order reference" text is a <dt> on the detail page,
        // outside this component, so nothing associates it with the input.
        // A placeholder is not an accessible name — and it disappears on typing.
        aria-label="Order reference"
        className="w-full px-2.5 py-1.5 border border-slate-200 rounded text-sm focus:outline-none focus:border-teal-500 bg-white"
      />
      <button
        type="button"
        onClick={save}
        disabled={pending}
        className="px-3 py-1.5 text-xs bg-teal-600 hover:bg-teal-700 disabled:bg-slate-300 text-white rounded font-medium"
      >
        {pending ? "Saving…" : "Save"}
      </button>
      <button
        type="button"
        onClick={() => {
          setValue(reference ?? "");
          setEditing(false);
        }}
        disabled={pending}
        className="px-2 py-1.5 text-xs text-slate-600 hover:text-slate-900"
      >
        Cancel
      </button>
    </div>
  );
}
