"use client";

// Where this order's goods are delivered — the 收货地址 its purchase orders
// print.
//
// Almost every order leaves this alone: "Default" follows whatever address the
// business is currently shipping through, so changing forwarders changes every
// order that has not said otherwise. Naming one here is the exception — a
// customer's goods routed somewhere else — and it stays named even if the
// default moves afterwards.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { AppSelect } from "@/components/ui/app-select";
import { setOrderDeliveryVendor } from "@/lib/actions/procurement";

export type ShipsToOption = {
  id: string;
  label: string;
  isDefault: boolean;
  isActive: boolean;
};

/**
 * The "no choice made" option, which is what nearly every order uses.
 *
 * Names the address it resolves to, so the picker says where the goods are
 * actually going rather than making the reader open the admin screen to find
 * out. An address literally called "Default" would read "Default — Default", so
 * that one degenerate case says it once.
 */
function defaultLabel(label: string | undefined): string {
  if (!label) return "Default — none set up";
  return label.trim().toLowerCase() === "default"
    ? "Default address"
    : `Default — ${label}`;
}

export function ShipsToSelect({
  orderId,
  addresses,
  selectedId,
  /** True when the order flies. A sea order prints no delivery block at all. */
  isAir,
}: {
  orderId: string;
  addresses: ShipsToOption[];
  selectedId: string | null;
  isAir: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Optimistic: the select must move under the finger, not after a round trip.
  const [value, setValue] = useState(selectedId ?? "");

  const defaultAddress = addresses.find((a) => a.isDefault);

  // Archived addresses are not offerable — but one already chosen stays in the
  // list, or the select would silently blank the answer this order gave.
  const options = addresses
    .filter((a) => a.isActive || a.id === selectedId)
    .map((a) => ({
      value: a.id,
      label: a.isActive ? a.label : `${a.label} (archived)`,
    }));

  function choose(next: string) {
    const previous = value;
    setValue(next);
    startTransition(async () => {
      try {
        await setOrderDeliveryVendor(orderId, next === "" ? null : next);
        router.refresh();
      } catch (e) {
        setValue(previous);
        toast.error(e instanceof Error ? e.message : "Could not save that");
      }
    });
  }

  return (
    <div className="mb-4 rounded-lg border border-slate-200 bg-white px-4 py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-800">
          Ships to <span className="text-slate-500">收货地址</span>
        </p>
        <p className="text-xs text-slate-500 mt-0.5">
          {!isAir ? (
            <>
              This order goes by sea, so its purchase orders print no delivery
              block — 空运唛头 is an <em>air</em> shipping mark. Set here anyway
              if the freight mode changes.
            </>
          ) : addresses.length === 0 ? (
            "No delivery address is set up. Add one under Admin → Procurement."
          ) : (
            <>
              Printed on this order&apos;s purchase orders. Documents already
              generated keep the address they were generated with.
            </>
          )}
        </p>
      </div>

      <div className="w-full sm:w-72 shrink-0">
        <AppSelect
          value={value}
          onChange={choose}
          options={options}
          noneLabel={defaultLabel(defaultAddress?.label)}
          disabled={pending}
        />
      </div>
    </div>
  );
}
