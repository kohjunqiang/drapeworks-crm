"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { Check, Clock3, PackageSearch, Truck } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  assignFreightComponents,
  setShipmentNotNeeded,
  saveShipmentArrivals,
} from "@/lib/actions/logistics";
import type { FulfilmentStatus } from "@/lib/db/schema";
import { canRecordShipmentArrival } from "@/lib/logistics/arrival-status";
import { formatFreightAge, normalizeFreightNumber } from "@/lib/logistics/freight";
import {
  SHIPMENT_CATEGORY_LABELS,
  type ShipmentCategory,
} from "@/lib/logistics/shipments";

import { shipmentCategoryTone } from "./shipment-presentation";

export type FreightComponent = {
  orderId: string;
  orderIdentifier: string;
  customerName: string;
  development: string | null;
  category: ShipmentCategory;
  freightNumber: string | null;
  freightAssignedAt: string | null;
  arrivedCheckedAt: string | null;
  updatedAt: string;
  currentStatus: FulfilmentStatus;
  assignable: boolean;
  notNeeded?: boolean;
};

type FreightManagerContextValue = {
  openFreight: (freightNumber?: string, search?: string, target?: Pick<FreightComponent, "orderId" | "category">) => void;
};

const FreightManagerContext = createContext<FreightManagerContextValue | null>(null);

function componentKey(component: Pick<FreightComponent, "orderId" | "category">) {
  return `${component.orderId}:${component.category}`;
}

function selectionForCode(components: FreightComponent[], freightNumber: string) {
  const normalized = normalizeFreightNumber(freightNumber);
  if (!normalized) return new Set<string>();
  return new Set(
    components
      .filter((component) =>
        component.freightNumber &&
        normalizeFreightNumber(component.freightNumber) === normalized)
      .map(componentKey),
  );
}

function sameSelection(a: Set<string>, b: Set<string>): boolean {
  return a.size === b.size && [...a].every((key) => b.has(key));
}

export function FreightManagerProvider({
  children,
  components,
  canManage,
  referenceTime,
}: {
  children: ReactNode;
  components: FreightComponent[];
  canManage: boolean;
  referenceTime: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [freightNumber, setFreightNumber] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [savedSelection, setSavedSelection] = useState<Set<string>>(new Set());
  const [assignmentTarget, setAssignmentTarget] = useState<string | null>(null);
  const [confirmReassign, setConfirmReassign] = useState(false);
  const [pending, startTransition] = useTransition();
  const [arrivalPending, startArrivalTransition] = useTransition();

  const openFreight = useCallback((number = "", initialSearch = "", target?: Pick<FreightComponent, "orderId" | "category">) => {
    const normalized = normalizeFreightNumber(number);
    const initial = selectionForCode(components, normalized);
    const targetKey = target && components.some((component) =>
      componentKey(component) === componentKey(target))
      ? componentKey(target) : null;
    setAssignmentTarget(targetKey);
    setFreightNumber(normalized);
    setSelected(new Set([...initial, ...(targetKey && components.find((component) => componentKey(component) === targetKey)?.assignable ? [targetKey] : [])]));
    setSavedSelection(new Set(initial));
    setSearch(initialSearch);
    setConfirmReassign(false);
    setOpen(true);
  }, [components]);

  const targetComponent = components.find((component) => componentKey(component) === assignmentTarget);
  function toggleNeeded() {
    if (!targetComponent) return;
    startTransition(async () => {
      try {
        await setShipmentNotNeeded({
          orderId: targetComponent.orderId, category: targetComponent.category,
          notNeeded: !targetComponent.notNeeded, expectedUpdatedAt: targetComponent.updatedAt,
        });
        toast.success(targetComponent.notNeeded ? "Shipment restored" : "Shipment marked Not needed");
        setOpen(false);
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not update shipment");
      }
    });
  }

  const normalizedFreight = normalizeFreightNumber(freightNumber);
  const currentMembers = useMemo(
    () => components.filter((component) =>
      component.freightNumber &&
      normalizeFreightNumber(component.freightNumber) === normalizedFreight),
    [components, normalizedFreight],
  );
  const selectedComponents = useMemo(
    () => components.filter((component) => selected.has(componentKey(component))),
    [components, selected],
  );
  const reassignments = selectedComponents.filter((component) =>
    component.freightNumber &&
    normalizeFreightNumber(component.freightNumber) !== normalizedFreight);
  const selectedOrderCount = new Set(selectedComponents.map((component) => component.orderId)).size;
  const startedAt = currentMembers
    .map((component) => component.freightAssignedAt)
    .filter((value): value is string => Boolean(value))
    .sort()[0] ?? null;
  const arrivedCount = currentMembers.filter((component) => component.arrivedCheckedAt).length;
  const allArrived = currentMembers.length > 0 && arrivedCount === currentMembers.length;

  const visibleComponents = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return components.filter((component) => {
      const belongsToCurrent = Boolean(
        normalizedFreight && component.freightNumber &&
        normalizeFreightNumber(component.freightNumber) === normalizedFreight,
      );
      if (!component.assignable && !belongsToCurrent) return false;
      if (!needle) return true;
      return [
        component.orderIdentifier,
        component.customerName,
        component.development,
        SHIPMENT_CATEGORY_LABELS[component.category],
        component.freightNumber,
      ].some((value) => value?.toLowerCase().includes(needle));
    }).sort((a, b) => {
      const aCurrent = Boolean(a.freightNumber &&
        normalizeFreightNumber(a.freightNumber) === normalizedFreight);
      const bCurrent = Boolean(b.freightNumber &&
        normalizeFreightNumber(b.freightNumber) === normalizedFreight);
      if (aCurrent !== bCurrent) return aCurrent ? -1 : 1;
      return a.orderIdentifier.localeCompare(b.orderIdentifier, undefined, {
        numeric: true,
      });
    });
  }, [components, normalizedFreight, search]);

  const grouped = useMemo(() => {
    const groups = new Map<string, FreightComponent[]>();
    for (const component of visibleComponents) {
      const rows = groups.get(component.orderId) ?? [];
      rows.push(component);
      groups.set(component.orderId, rows);
    }
    return [...groups.values()];
  }, [visibleComponents]);

  function changeFreightNumber(value: string) {
    setFreightNumber(value);
    const existing = selectionForCode(components, value);
    setSelected(new Set([...existing, ...(assignmentTarget && components.find((component) => componentKey(component) === assignmentTarget)?.assignable ? [assignmentTarget] : [])]));
    setSavedSelection(new Set(existing));
    setConfirmReassign(false);
  }

  function toggleComponent(component: FreightComponent) {
    const key = componentKey(component);
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setConfirmReassign(false);
  }

  function saveAssignments() {
    startTransition(async () => {
      try {
        await assignFreightComponents({
          freightNumber: normalizedFreight,
          components: selectedComponents.map(({ orderId, category }) => ({
            orderId,
            category,
          })),
          confirmReassign,
        });
        setSavedSelection(new Set(selected));
        toast.success(
          `${normalizedFreight} assigned to ${selected.size} component${selected.size === 1 ? "" : "s"}`,
        );
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not save freight assignments");
      }
    });
  }

  function markArrived(component: FreightComponent) {
    startArrivalTransition(async () => {
      try {
        const orderComponents = components.filter((row) => row.orderId === component.orderId);
        const completesOrder = orderComponents.every((row) =>
          row.notNeeded || row.arrivedCheckedAt || componentKey(row) === componentKey(component));
        await saveShipmentArrivals({
          orderId: component.orderId,
          arrivals: [{
            category: component.category,
            arrivedChecked: true,
            expectedUpdatedAt: component.updatedAt,
          }],
          markDelivered: completesOrder && component.currentStatus === "shipping_sg",
        });
        toast.success(`${SHIPMENT_CATEGORY_LABELS[component.category]} marked arrived`);
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not save arrival");
      }
    });
  }

  function markAllArrived() {
    const unarrived = currentMembers.filter((component) =>
      !component.notNeeded && !component.arrivedCheckedAt && canRecordShipmentArrival(component.currentStatus));
    const byOrder = new Map<string, FreightComponent[]>();
    for (const component of unarrived) {
      const rows = byOrder.get(component.orderId) ?? [];
      rows.push(component);
      byOrder.set(component.orderId, rows);
    }
    startArrivalTransition(async () => {
      try {
        for (const [orderId, arrivals] of byOrder) {
          const arrivingKeys = new Set(arrivals.map(componentKey));
          const orderComponents = components.filter((row) => row.orderId === orderId);
          const completesOrder = orderComponents.every((row) =>
            row.notNeeded || row.arrivedCheckedAt || arrivingKeys.has(componentKey(row)));
          await saveShipmentArrivals({
            orderId,
            arrivals: arrivals.map((component) => ({
              category: component.category,
              arrivedChecked: true,
              expectedUpdatedAt: component.updatedAt,
            })),
            markDelivered: completesOrder && arrivals[0].currentStatus === "shipping_sg",
          });
        }
        toast.success(`${unarrived.length} component${unarrived.length === 1 ? "" : "s"} marked arrived`);
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not save arrivals");
      }
    });
  }

  const dirty = !sameSelection(selected, savedSelection);
  const canSave = canManage && Boolean(normalizedFreight) && selected.size > 0 &&
    dirty && (reassignments.length === 0 || confirmReassign);

  return (
    <FreightManagerContext.Provider value={{ openFreight }}>
      {children}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="!w-full gap-0 sm:!w-[640px] sm:!max-w-[640px] [&_button]:min-h-11 [&_button]:min-w-11 [&_input:not([type=checkbox])]:min-h-11 [&_input]:text-base sm:[&_input]:text-sm">
          <SheetHeader className="border-b border-slate-200 px-5 py-4 pr-14">
            <SheetTitle className="flex items-center gap-2 text-lg">
              <Truck className="size-5 text-teal-700" /> Manage overseas freight
            </SheetTitle>
            <SheetDescription>
              Enter one code, then link all order components travelling together.
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto">
            <div className={`space-y-4 p-5 ${normalizedFreight ? "border-b border-slate-200" : ""}`}>
              <div className="space-y-1.5">
                {targetComponent && canManage && !targetComponent.freightNumber && !targetComponent.arrivedCheckedAt && (
                  <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="text-sm font-medium">{targetComponent.orderIdentifier} · {SHIPMENT_CATEGORY_LABELS[targetComponent.category]}</p>
                    <p className="mt-1 text-xs text-slate-600">{targetComponent.notNeeded ? "This shipment is not needed. Restore it to assign freight." : "If this shipment is not required for the order, mark it Not needed."}</p>
                    <Button type="button" variant="outline" className="mt-2" disabled={pending} onClick={toggleNeeded}>
                      {targetComponent.notNeeded ? "Restore as needed" : "Mark as not needed"}
                    </Button>
                  </div>
                )}
                <label htmlFor="freight-code" className="text-xs font-semibold text-slate-700">
                  Freight code
                </label>
                <Input
                  id="freight-code"
                  value={freightNumber}
                  maxLength={200}
                  autoComplete="off"
                  className="h-10 font-mono text-base font-semibold uppercase"
                  onChange={(event) => changeFreightNumber(event.target.value)}
                />
                <p className="text-xs text-slate-500">
                  Use the overseas freight code provided by the shipping partner.
                </p>
              </div>

              {normalizedFreight && currentMembers.length > 0 && (
                <div className={`rounded-lg border p-3 ${allArrived ? "border-emerald-200 bg-emerald-50" : "border-teal-200 bg-teal-50"}`}>
                  <div className="grid grid-cols-3 gap-2">
                  <div>
                    <p className={`text-[11px] font-medium uppercase tracking-wide ${allArrived ? "text-emerald-700" : "text-teal-700"}`}>
                      {allArrived ? "Status" : "In transit"}
                    </p>
                    <p className={`mt-0.5 flex items-center gap-1 font-semibold ${allArrived ? "text-emerald-900" : "text-teal-950"}`}>
                      {allArrived ? <><Check className="size-3.5" /> Arrived</> : <><Clock3 className="size-3.5" /> {formatFreightAge(startedAt, referenceTime) ?? "—"}</>}
                    </p>
                  </div>
                  <div>
                    <p className={`text-[11px] font-medium uppercase tracking-wide ${allArrived ? "text-emerald-700" : "text-teal-700"}`}>Components</p>
                    <p className={`mt-0.5 font-semibold ${allArrived ? "text-emerald-900" : "text-teal-950"}`}>{currentMembers.length}</p>
                  </div>
                  <div>
                    <p className={`text-[11px] font-medium uppercase tracking-wide ${allArrived ? "text-emerald-700" : "text-teal-700"}`}>Arrived</p>
                    <p className={`mt-0.5 font-semibold ${allArrived ? "text-emerald-900" : "text-teal-950"}`}>{arrivedCount} of {currentMembers.length}</p>
                  </div>
                  </div>
                  {canManage && currentMembers.some((component) =>
                    !component.notNeeded && !component.arrivedCheckedAt && canRecordShipmentArrival(component.currentStatus)) && (
                    <button
                      type="button"
                      disabled={arrivalPending || dirty}
                      className="mt-3 w-full rounded-md border border-teal-300 bg-white px-3 py-1.5 text-xs font-semibold text-teal-800 hover:bg-teal-100 disabled:opacity-50"
                      onClick={markAllArrived}
                    >
                      {arrivalPending ? "Saving arrivals…" : "Mark all in this freight as arrived"}
                    </button>
                  )}
                </div>
              )}

              {normalizedFreight && (
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-slate-700">
                    Order components
                  </p>
                  <p className="text-xs text-slate-500">
                    Choose every curtain, blind or track travelling under this code.
                  </p>
                  <label htmlFor="freight-component-search" className="block pt-2 text-xs font-medium text-slate-600">
                    Filter orders <span className="font-normal text-slate-400">(optional)</span>
                  </label>
                  <div className="relative pt-1">
                    <PackageSearch className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                    <Input
                      id="freight-component-search"
                      value={search}
                      className="h-10 pl-9"
                      onChange={(event) => setSearch(event.target.value)}
                    />
                  </div>
                  <p className="text-[11px] text-slate-500">Order number, customer or development</p>
                </div>
              )}
            </div>

            {normalizedFreight && <div className="space-y-3 p-5">
              {grouped.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-500">
                  No order components match this filter.
                </div>
              ) : grouped.map((orderComponents) => {
                const order = orderComponents[0];
                return (
                  <section key={order.orderId} className="overflow-hidden rounded-lg border border-slate-200">
                    <div className="border-b border-slate-100 bg-slate-50 px-3 py-2.5">
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="font-semibold text-slate-900">Order {order.orderIdentifier}</p>
                        <p className="truncate text-xs text-slate-500">{order.customerName}</p>
                      </div>
                      {order.development && <p className="mt-0.5 truncate text-xs text-slate-500">{order.development}</p>}
                    </div>
                    <div className="divide-y divide-slate-100">
                      {orderComponents.map((component) => {
                        const key = componentKey(component);
                        const checked = selected.has(key);
                        const belongsToCurrent = Boolean(
                          component.freightNumber &&
                          normalizeFreightNumber(component.freightNumber) === normalizedFreight,
                        );
                        const locked = Boolean(component.arrivedCheckedAt);
                        return (
                          <div key={key} className="flex items-center gap-3 px-3 py-3">
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={!canManage || locked || belongsToCurrent}
                              aria-label={`Assign ${SHIPMENT_CATEGORY_LABELS[component.category]} from order ${component.orderIdentifier}`}
                              className="size-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                              onChange={() => toggleComponent(component)}
                            />
                            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${shipmentCategoryTone(component.category).dot}`} />
                            <div className="min-w-0 flex-1">
                              <p className="font-medium text-slate-800">{SHIPMENT_CATEGORY_LABELS[component.category]}</p>
                              {component.freightNumber && !belongsToCurrent && (
                                <p className="mt-0.5 text-xs text-amber-700">
                                  Currently {component.freightNumber} · selecting will reassign
                                </p>
                              )}
                              {component.freightAssignedAt && belongsToCurrent && (
                                <p className="mt-0.5 text-xs text-slate-500">
                                  Linked {formatFreightAge(component.freightAssignedAt, referenceTime)} ago
                                </p>
                              )}
                            </div>
                            {component.arrivedCheckedAt ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-700">
                                <Check className="size-3" /> Arrived
                              </span>
                            ) : belongsToCurrent && !component.notNeeded && canRecordShipmentArrival(component.currentStatus) && canManage ? (
                              <Button
                                type="button"
                                variant="outline"
                                size="xs"
                                disabled={arrivalPending || dirty}
                                onClick={() => markArrived(component)}
                              >
                                Mark arrived
                              </Button>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>}
          </div>

          {normalizedFreight && <SheetFooter className="border-t border-slate-200 bg-white px-5 py-4">
            {reassignments.length > 0 && (
              <label className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                <input
                  type="checkbox"
                  checked={confirmReassign}
                  className="mt-0.5 size-4 rounded border-amber-400 text-amber-600 focus:ring-amber-500"
                  onChange={(event) => setConfirmReassign(event.target.checked)}
                />
                Confirm reassignment of {reassignments.length} component{reassignments.length === 1 ? "" : "s"} from another freight code.
              </label>
            )}
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-slate-600">
                <span className="font-semibold text-slate-900">{selected.size}</span> component{selected.size === 1 ? "" : "s"} across{" "}
                <span className="font-semibold text-slate-900">{selectedOrderCount}</span> order{selectedOrderCount === 1 ? "" : "s"}
              </p>
              <Button type="button" disabled={!canSave || pending} onClick={saveAssignments}>
                {pending ? "Saving…" : currentMembers.length > 0 ? "Save assignments" : `Create ${normalizedFreight || "freight"}`}
              </Button>
            </div>
          </SheetFooter>}
        </SheetContent>
      </Sheet>
    </FreightManagerContext.Provider>
  );
}

export function ManageFreightButton() {
  const manager = useContext(FreightManagerContext);
  if (!manager) return null;
  return (
    <Button type="button" variant="outline" className="h-9" onClick={() => manager.openFreight()}>
      <Truck className="size-4" /> Manage freight
    </Button>
  );
}

export function FreightPillButton({
  freightNumber,
  children,
  className,
  ariaLabel,
}: {
  freightNumber: string;
  children: ReactNode;
  className: string;
  ariaLabel: string;
}) {
  const manager = useContext(FreightManagerContext);
  return (
    <button
      type="button"
      className={`${className} outline-none transition hover:brightness-95 focus-visible:ring-2 focus-visible:ring-teal-500`}
      aria-label={ariaLabel}
      onClick={() => manager?.openFreight(freightNumber)}
    >
      {children}
    </button>
  );
}

export function AssignFreightButton({ orderIdentifier, target, children = "Assign freight", className, ariaLabel }: {
  orderIdentifier: string;
  target?: Pick<FreightComponent, "orderId" | "category">;
  children?: ReactNode;
  className?: string;
  ariaLabel?: string;
}) {
  const manager = useContext(FreightManagerContext);
  if (!manager) return null;
  return (
    <button
      type="button"
      className={className ?? "rounded px-1.5 py-1 text-xs font-medium text-teal-700 outline-none hover:bg-teal-50 focus-visible:ring-2 focus-visible:ring-teal-500"}
      aria-label={ariaLabel}
      onClick={() => manager.openFreight("", orderIdentifier, target)}
    >
      {children}
    </button>
  );
}
