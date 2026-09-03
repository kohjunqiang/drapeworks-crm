"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  reopenShipmentArrival,
  saveDeliveryNumbers,
  saveShipmentArrivals,
} from "@/lib/actions/logistics";
import type { FulfilmentStatus } from "@/lib/db/schema";
import {
  requiresLocalDelivery,
  SHIPMENT_CATEGORY_LABELS,
  type ShipmentValues,
} from "@/lib/logistics/shipments";
import { statusIndex } from "@/lib/status-flow";

type Props = {
  orderId: string;
  shipments: ShipmentValues[];
  currentStatus: FulfilmentStatus;
  canEdit: boolean;
  canReopenArrival: boolean;
};

export function DeliveryNumbersCard({
  orderId,
  shipments: initial,
  currentStatus,
  canEdit,
  canReopenArrival,
}: Props) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<ShipmentValues[] | null>(null);
  const shipments = drafts ?? initial;
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [arrivalPending, startArrivalTransition] = useTransition();
  const [arrivalDrafts, setArrivalDrafts] = useState<Record<string, boolean>>(
    () => Object.fromEntries(initial.map((shipment) => [
      shipment.category,
      Boolean(shipment.arrivedCheckedAt),
    ])),
  );
  const [arrivalNote, setArrivalNote] = useState("");
  const [reopeningCategory, setReopeningCategory] = useState<string | null>(null);
  const [reopenReason, setReopenReason] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const localReached =
    statusIndex(currentStatus) >= statusIndex("sent_logistic");
  const overseasReached =
    statusIndex(currentStatus) >= statusIndex("shipping_sg");
  const incomplete = initial.some((shipment) =>
    (localReached && requiresLocalDelivery(shipment.category) &&
      !shipment.localDeliveryNumber?.trim()) ||
    (overseasReached && !shipment.overseasFreightNumber?.trim()));
  const arrivedCount = shipments.filter((shipment) =>
    currentStatus === "shipping_sg"
      ? Boolean(arrivalDrafts[shipment.category])
      : Boolean(shipment.arrivedCheckedAt)).length;
  const allDraftArrived = shipments.length > 0 && arrivedCount === shipments.length;
  const hasArrivalChanges = initial.some((shipment) =>
    Boolean(shipment.arrivedCheckedAt) !==
      Boolean(arrivalDrafts[shipment.category]));

  function update(
    category: ShipmentValues["category"],
    key: "localDeliveryNumber" | "overseasFreightNumber",
    value: string,
  ) {
    setDrafts((current) => (current ?? initial).map((shipment) =>
      shipment.category === category ? { ...shipment, [key]: value } : shipment));
  }

  function save() {
    const missing = shipments.flatMap((shipment) => {
      const fields: Array<{ category: ShipmentValues["category"]; field: "local" | "overseas" }> = [];
      if (
        localReached && requiresLocalDelivery(shipment.category) &&
        !shipment.localDeliveryNumber?.trim()
      ) {
        fields.push({ category: shipment.category, field: "local" });
      }
      if (overseasReached && !shipment.overseasFreightNumber?.trim()) {
        fields.push({ category: shipment.category, field: "overseas" });
      }
      return fields;
    });
    if (missing.length > 0) {
      setFieldErrors(Object.fromEntries(missing.map(({ category, field }) => [
        `${category}-${field}`,
        field === "local"
          ? "Local delivery number is required."
          : "Overseas freight number is required.",
      ])));
      window.setTimeout(() => {
        const first = missing[0];
        document.getElementById(`${first.category}-${first.field}-number`)?.focus();
      });
      return;
    }
    startTransition(async () => {
      try {
        await saveDeliveryNumbers({
          orderId,
          shipments: shipments.map((shipment) => ({
            ...shipment,
            expectedUpdatedAt: new Date(shipment.updatedAt).toISOString(),
          })),
        });
        toast.success("Shipment numbers saved");
        setDrafts(null);
        setEditing(false);
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Could not save shipment numbers",
        );
      }
    });
  }

  function saveArrivals() {
    const changed = initial.filter((shipment) =>
      Boolean(shipment.arrivedCheckedAt) !==
        Boolean(arrivalDrafts[shipment.category]));
    startArrivalTransition(async () => {
      try {
        const result = await saveShipmentArrivals({
          orderId,
          arrivals: changed.map((shipment) => ({
            category: shipment.category,
            arrivedChecked: Boolean(arrivalDrafts[shipment.category]),
            expectedUpdatedAt: new Date(shipment.updatedAt).toISOString(),
          })),
          note: arrivalNote || undefined,
          markDelivered: allDraftArrived,
        });
        toast.success(result.delivered
          ? "Order marked Delivered & Checked"
          : "Arrival progress saved");
        setArrivalNote("");
        router.refresh();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Could not save arrival progress",
        );
      }
    });
  }

  function reopenArrival(shipment: ShipmentValues) {
    startArrivalTransition(async () => {
      try {
        await reopenShipmentArrival({
          orderId,
          category: shipment.category,
          expectedUpdatedAt: new Date(shipment.updatedAt).toISOString(),
          reason: reopenReason,
        });
        toast.success("Arrival reopened; order returned to Shipping to SG");
        setReopeningCategory(null);
        setReopenReason("");
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not reopen arrival");
      }
    });
  }

  if (shipments.length === 0) return null;

  return (
    <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-slate-900">Shipments</h2>
          <p className="text-xs text-slate-500">
            Each vendor or track order is followed until it arrives and is checked.
          </p>
          {overseasReached && (
            <p aria-live="polite" className="mt-1 text-xs font-medium text-slate-700">
              {arrivedCount} of {shipments.length} shipments arrived and checked
            </p>
          )}
        </div>
        {canEdit && localReached && !editing && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setDrafts(initial);
              setFieldErrors({});
              setEditing(true);
            }}
          >
            Edit shipment numbers
          </Button>
        )}
      </div>

      <div className="space-y-3">
        {incomplete && (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Tracking details are incomplete for the current stage.
          </p>
        )}
        {Object.keys(fieldErrors).length > 0 && (
          <p role="alert" className="text-xs font-medium text-red-600">
            Enter all required shipment numbers.
          </p>
        )}
        {shipments.map((shipment) => {
          const label = SHIPMENT_CATEGORY_LABELS[shipment.category];
          const localId = `${shipment.category}-local-number`;
          const overseasId = `${shipment.category}-overseas-number`;
          const lockedHintId = `${shipment.category}-arrived-lock-hint`;
          return (
            <div
              key={shipment.category}
              className="rounded-md border border-slate-200 p-3"
            >
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-medium text-slate-900">{label}</h3>
                {shipment.source !== "derived" && (
                  <span className="text-xs text-slate-500">
                    {shipment.source === "legacy_combined"
                      ? "Imported combined reference — confirm dedicated numbers"
                      : "Imported legacy shipment"}
                  </span>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  {!requiresLocalDelivery(shipment.category) ? (
                    <>
                      <p className="text-xs font-medium text-slate-600">Local delivery</p>
                      <p className="text-sm font-medium text-sky-700">Direct shipment</p>
                      {shipment.localDeliveryNumber && (
                        <p className="text-xs text-slate-500">
                          Legacy local reference: {shipment.localDeliveryNumber}
                        </p>
                      )}
                    </>
                  ) : editing && localReached ? (
                    <>
                      <label htmlFor={localId} className="text-xs font-medium text-slate-600">
                        Local delivery number
                      </label>
                      <Input
                        id={localId}
                        value={shipment.localDeliveryNumber ?? ""}
                        disabled={pending || Boolean(shipment.arrivedCheckedAt)}
                        maxLength={200}
                        aria-invalid={Boolean(fieldErrors[`${shipment.category}-local`])}
                        aria-describedby={[
                          fieldErrors[`${shipment.category}-local`] ? `${localId}-error` : null,
                          shipment.arrivedCheckedAt ? lockedHintId : null,
                        ].filter(Boolean).join(" ") || undefined}
                        onChange={(event) => {
                          update(shipment.category, "localDeliveryNumber", event.target.value);
                          setFieldErrors((current) => {
                            const next = { ...current };
                            delete next[`${shipment.category}-local`];
                            return next;
                          });
                        }}
                      />
                      {fieldErrors[`${shipment.category}-local`] && (
                        <p id={`${localId}-error`} className="text-xs text-red-600">
                          {fieldErrors[`${shipment.category}-local`]}
                        </p>
                      )}
                    </>
                  ) : (
                    <>
                      <p className="text-xs font-medium text-slate-600">Local delivery number</p>
                      <p className="text-sm text-slate-900">
                        {shipment.localDeliveryNumber || (localReached
                          ? "Not recorded"
                          : "Recorded when sent to logistic partner")}
                      </p>
                    </>
                  )}
                </div>
                <div className="space-y-1">
                  {editing && overseasReached ? (
                    <>
                      <label htmlFor={overseasId} className="text-xs font-medium text-slate-600">
                        Overseas freight number
                      </label>
                      <Input
                        id={overseasId}
                        value={shipment.overseasFreightNumber ?? ""}
                        disabled={pending || Boolean(shipment.arrivedCheckedAt)}
                        maxLength={200}
                        aria-invalid={Boolean(fieldErrors[`${shipment.category}-overseas`])}
                        aria-describedby={[
                          fieldErrors[`${shipment.category}-overseas`] ? `${overseasId}-error` : null,
                          shipment.arrivedCheckedAt ? lockedHintId : null,
                        ].filter(Boolean).join(" ") || undefined}
                        onChange={(event) => {
                          update(shipment.category, "overseasFreightNumber", event.target.value);
                          setFieldErrors((current) => {
                            const next = { ...current };
                            delete next[`${shipment.category}-overseas`];
                            return next;
                          });
                        }}
                      />
                      {fieldErrors[`${shipment.category}-overseas`] && (
                        <p id={`${overseasId}-error`} className="text-xs text-red-600">
                          {fieldErrors[`${shipment.category}-overseas`]}
                        </p>
                      )}
                      {shipment.arrivedCheckedAt && (
                        <p id={lockedHintId} className="text-xs text-slate-500">
                          {currentStatus === "shipping_sg"
                            ? "Cancel number editing, uncheck Arrived and checked, add a reason, then save arrival progress."
                            : "Use Correct this arrival below before changing its tracking numbers."}
                        </p>
                      )}
                    </>
                  ) : (
                    <>
                      <p className="text-xs font-medium text-slate-600">Overseas freight number</p>
                      <p className="text-sm text-slate-900">
                        {shipment.overseasFreightNumber || (overseasReached
                          ? "Not recorded"
                          : "Recorded when shipping to SG")}
                      </p>
                    </>
                  )}
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-medium text-slate-600">Arrival</p>
                  {currentStatus === "shipping_sg" ? (
                    <label className="flex min-h-10 items-center gap-2 text-sm text-slate-800">
                      <input
                        type="checkbox"
                        checked={Boolean(arrivalDrafts[shipment.category])}
                        disabled={arrivalPending || editing || !shipment.overseasFreightNumber}
                        onChange={(event) => setArrivalDrafts((current) => ({
                          ...current,
                          [shipment.category]: event.target.checked,
                        }))}
                        className="rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                      />
                      {label} arrived and checked
                    </label>
                  ) : (
                    <div className="space-y-1">
                      <p className="text-sm text-slate-900">
                        {shipment.arrivedCheckedAt
                          ? `Arrived and checked · ${new Intl.DateTimeFormat("en-SG", {
                              day: "2-digit", month: "short", year: "numeric",
                              timeZone: "Asia/Singapore",
                            }).format(new Date(shipment.arrivedCheckedAt))}`
                          : overseasReached ? "Awaiting arrival" : "Recorded after shipping"}
                      </p>
                      {canReopenArrival && currentStatus === "delivered_checked" &&
                        shipment.arrivedCheckedAt && (
                        reopeningCategory === shipment.category ? (
                          <div className="space-y-2 pt-1">
                            <label htmlFor={`${shipment.category}-reopen-reason`} className="text-xs font-medium text-slate-600">
                              Reason for reopening
                            </label>
                            <Input
                              id={`${shipment.category}-reopen-reason`}
                              value={reopenReason}
                              maxLength={2000}
                              disabled={arrivalPending}
                              onChange={(event) => setReopenReason(event.target.value)}
                            />
                            <div className="flex gap-2">
                              <Button size="sm" variant="outline" disabled={arrivalPending} onClick={() => {
                                setReopeningCategory(null);
                                setReopenReason("");
                              }}>Cancel</Button>
                              <Button size="sm" disabled={arrivalPending || !reopenReason.trim()} onClick={() => reopenArrival(shipment)}>
                                Reopen arrival
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <button type="button" className="text-xs font-medium text-amber-700 underline underline-offset-2" onClick={() => setReopeningCategory(shipment.category)}>
                            Correct this arrival
                          </button>
                        )
                      )}
                    </div>
                  )}
                  {(shipment.legacyLocalDeliveryNumber || shipment.legacyOverseasFreightNumber) && (
                    <p className="text-xs text-slate-500">
                      Previous combined reference: {[shipment.legacyLocalDeliveryNumber,
                        shipment.legacyOverseasFreightNumber].filter(Boolean).join(" / ")}
                    </p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {editing && (
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => {
              setDrafts(null);
              setFieldErrors({});
              setEditing(false);
            }}
          >
            Cancel
          </Button>
          <Button disabled={pending} onClick={save}>
            {pending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      )}
      {currentStatus === "shipping_sg" && !editing && (
        <div className="space-y-2 border-t border-slate-200 pt-4">
          {initial.some((shipment) =>
            Boolean(shipment.arrivedCheckedAt) &&
            !arrivalDrafts[shipment.category]) && (
            <div className="space-y-1">
              <label htmlFor="arrival-reopen-note" className="text-xs font-medium text-slate-600">
                Reason for reopening an arrival check
              </label>
              <Input
                id="arrival-reopen-note"
                value={arrivalNote}
                maxLength={2000}
                disabled={arrivalPending}
                onChange={(event) => setArrivalNote(event.target.value)}
              />
            </div>
          )}
          <div className="flex justify-end">
            <Button
              disabled={arrivalPending || incomplete ||
                (!hasArrivalChanges && !allDraftArrived)}
              onClick={saveArrivals}
            >
              {arrivalPending
                ? "Saving…"
                : allDraftArrived
                  ? "Save & mark Delivered & Checked"
                  : !hasArrivalChanges
                    ? "No arrival changes"
                  : `Save arrival progress · ${shipments.length - arrivedCount} remaining`}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
