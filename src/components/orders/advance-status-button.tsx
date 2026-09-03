"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { advanceOrderStatus } from "@/lib/actions/status";
import type { FulfilmentStatus } from "@/lib/db/schema";
import {
  requiresLocalDelivery,
  SHIPMENT_CATEGORY_LABELS,
  type ShipmentValues,
} from "@/lib/logistics/shipments";
import {
  CompletionPhotoUploader,
  type CompletionPhoto,
} from "@/components/orders/completion-photo-uploader";

type Props = {
  orderId: string;
  currentStatus: FulfilmentStatus;
  atEnd: boolean;
  nextLabel?: string;
  /** Overrides the generic "Advance →" wording. Used at order_recorded, where
   *  the action is specifically "the deposit has arrived". */
  ctaLabel?: string;
  /** Where to go after a successful advance. Set at order_recorded so recording
   *  the deposit lands on the measurements review — the thing recording it was
   *  for — instead of returning here and asking for a second click. */
  advanceTo?: string;
  completionPhotos?: CompletionPhoto[];
  shipments?: ShipmentValues[];
  manifestRecoveryHref?: string;
};

export function AdvanceStatusButton({
  orderId,
  currentStatus,
  atEnd,
  nextLabel,
  ctaLabel,
  advanceTo,
  completionPhotos = [],
  shipments = [],
  manifestRecoveryHref,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [photoUploading, setPhotoUploading] = useState(false);
  const manifestMissing = [
    "sent_to_vendor",
    "sent_logistic",
    "shipping_sg",
  ].includes(currentStatus) && shipments.length === 0;
  const trackingIncomplete =
    currentStatus === "shipping_sg" &&
    shipments.some((shipment) =>
      (requiresLocalDelivery(shipment.category) &&
        !shipment.localDeliveryNumber?.trim()) ||
      !shipment.overseasFreightNumber?.trim() ||
      !shipment.arrivedCheckedAt);
  const trackingMode = currentStatus === "sent_to_vendor"
    ? "local" as const
    : currentStatus === "sent_logistic"
      ? "overseas" as const
      : null;
  const hasLocalShipments = shipments.some((shipment) =>
    requiresLocalDelivery(shipment.category));
  const directOnlyLocalStep = trackingMode === "local" && !hasLocalShipments;
  const [localNumbers, setLocalNumbers] = useState<Record<string, string>>(
    () => Object.fromEntries(shipments.map((shipment) => [
      shipment.category,
      shipment.localDeliveryNumber ?? "",
    ])),
  );
  const [overseasNumbers, setOverseasNumbers] = useState<Record<string, string>>(
    () => Object.fromEntries(shipments.map((shipment) => [
      shipment.category,
      shipment.overseasFreightNumber ?? "",
    ])),
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function resetShipmentNumbers() {
    setLocalNumbers(Object.fromEntries(shipments.map((shipment) => [
      shipment.category,
      shipment.localDeliveryNumber ?? "",
    ])));
    setOverseasNumbers(Object.fromEntries(shipments.map((shipment) => [
      shipment.category,
      shipment.overseasFreightNumber ?? "",
    ])));
    setFieldErrors({});
  }

  function submit() {
    if (photoUploading) return;
    if (trackingMode) {
      const nextErrors: Record<string, string> = {};
      for (const shipment of shipments) {
        if (
          requiresLocalDelivery(shipment.category) &&
          !localNumbers[shipment.category]?.trim()
        ) {
          nextErrors[`${shipment.category}-local`] = "Local delivery number is required.";
        }
        if (
          trackingMode === "overseas" &&
          !overseasNumbers[shipment.category]?.trim()
        ) {
          nextErrors[`${shipment.category}-overseas`] = "Overseas freight number is required.";
        }
      }
      const firstError = Object.keys(nextErrors)[0];
      if (firstError) {
        setFieldErrors(nextErrors);
        window.setTimeout(() => {
          document.getElementById(`advance-${firstError}`)?.focus();
        });
        return;
      }
    }
    startTransition(async () => {
      try {
        await advanceOrderStatus({
          orderId,
          expectedStatus: currentStatus,
          note: note || undefined,
          shipmentNumbers: trackingMode
              ? shipments.map((shipment) => ({
                category: shipment.category,
                localDeliveryNumber: requiresLocalDelivery(shipment.category)
                  ? localNumbers[shipment.category].trim()
                  : undefined,
                overseasFreightNumber: trackingMode === "overseas"
                  ? overseasNumbers[shipment.category].trim()
                  : undefined,
              }))
            : undefined,
        });
        toast.success(
          nextLabel ? `Advanced to ${nextLabel}` : "Status advanced",
        );
        setOpen(false);
        setNote("");
        setFieldErrors({});
        if (advanceTo) router.push(advanceTo);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Advance failed");
      }
    });
  }

  if (atEnd) {
    return (
      <button
        type="button"
        disabled
        className="px-3 py-1.5 text-xs sm:text-sm bg-slate-300 text-white rounded font-medium cursor-not-allowed"
      >
        Completed
      </button>
    );
  }

  if (manifestMissing && manifestRecoveryHref) {
    return (
      <Link
        href={manifestRecoveryHref}
        className="rounded border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100 sm:text-sm"
      >
        Review shipment orders
      </Link>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          resetShipmentNumbers();
          setOpen(true);
        }}
        disabled={pending || trackingIncomplete || manifestMissing}
        className="px-3 py-1.5 text-xs sm:text-sm bg-teal-600 hover:bg-teal-700 disabled:bg-slate-300 text-white rounded font-medium"
      >
        {pending
          ? "Saving…"
          : manifestMissing
            ? "No shipment orders found"
            : trackingIncomplete
              ? "Complete shipment arrivals first"
            : (ctaLabel ?? "Advance →")}
      </button>
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && (pending || photoUploading)) return;
          setOpen(nextOpen);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {directOnlyLocalStep
                ? "Continue direct shipments"
                : trackingMode === "local"
                  ? "Send to logistic partner"
                : trackingMode === "overseas"
                  ? "Mark as shipping to SG"
                  : (ctaLabel ?? (nextLabel ? `Advance to ${nextLabel}` : "Advance status"))}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {trackingMode && shipments.length > 0 && (
              <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div>
                  <p className="text-sm font-medium text-slate-800">
                    {directOnlyLocalStep
                      ? "Direct shipments"
                      : trackingMode === "local"
                        ? "Local delivery numbers"
                      : "Overseas freight numbers"}
                  </p>
                  <p className="text-xs text-slate-500">
                    {directOnlyLocalStep
                      ? "These track orders are sent directly. No local delivery number is required."
                      : trackingMode === "local"
                      ? "Curtains, Blinds and Mesh go via the logistics partner. Track orders are sent directly."
                      : "Enter one overseas freight number for every shipment."}
                  </p>
                </div>
                {Object.keys(fieldErrors).length > 0 && (
                  <p role="alert" className="text-xs font-medium text-red-600">
                    Enter all required shipment numbers.
                  </p>
                )}
                <div className="space-y-3">
                  {shipments.map((shipment, index) => {
                    const localId = `advance-${shipment.category}-local`;
                    const overseasId = `advance-${shipment.category}-overseas`;
                    const localError = fieldErrors[`${shipment.category}-local`];
                    const overseasError = fieldErrors[`${shipment.category}-overseas`];
                    return (
                      <div key={shipment.category} className="space-y-1">
                        <p className="text-xs font-medium text-slate-700">
                          {SHIPMENT_CATEGORY_LABELS[shipment.category]}
                        </p>
                        {requiresLocalDelivery(shipment.category) &&
                        (trackingMode === "local" || !shipment.localDeliveryNumber) ? (
                          <div className="space-y-1">
                            <label htmlFor={localId} className="text-xs text-slate-600">
                              Local delivery number
                            </label>
                            <input
                              id={localId}
                              autoFocus={index === 0}
                              value={localNumbers[shipment.category] ?? ""}
                              onChange={(event) => {
                                setLocalNumbers((current) => ({
                                  ...current,
                                  [shipment.category]: event.target.value,
                                }));
                                setFieldErrors((current) => {
                                  const next = { ...current };
                                  delete next[`${shipment.category}-local`];
                                  return next;
                                });
                              }}
                              maxLength={200}
                              disabled={pending}
                              aria-invalid={Boolean(localError)}
                              aria-describedby={localError ? `${localId}-error` : undefined}
                              className="h-10 w-full rounded border border-slate-200 bg-white px-3 text-sm focus:border-teal-500 focus:outline-none disabled:bg-slate-100"
                            />
                            {localError && (
                              <p id={`${localId}-error`} className="text-xs text-red-600">
                                {localError}
                              </p>
                            )}
                          </div>
                        ) : requiresLocalDelivery(shipment.category) ? (
                          <p className="text-xs text-slate-500">
                            Local: {shipment.localDeliveryNumber}
                          </p>
                        ) : (
                          <p className="text-xs font-medium text-sky-700">
                            Direct shipment · no local delivery number required
                          </p>
                        )}
                        {trackingMode === "overseas" && (
                          <div className="space-y-1 pt-1">
                            <label htmlFor={overseasId} className="text-xs text-slate-600">
                              Overseas freight number
                            </label>
                            <input
                              id={overseasId}
                              autoFocus={index === 0 && Boolean(shipment.localDeliveryNumber)}
                              value={overseasNumbers[shipment.category] ?? ""}
                              onChange={(event) => {
                                setOverseasNumbers((current) => ({
                                  ...current,
                                  [shipment.category]: event.target.value,
                                }));
                                setFieldErrors((current) => {
                                  const next = { ...current };
                                  delete next[`${shipment.category}-overseas`];
                                  return next;
                                });
                              }}
                              maxLength={200}
                              disabled={pending}
                              aria-invalid={Boolean(overseasError)}
                              aria-describedby={overseasError ? `${overseasId}-error` : undefined}
                              className="h-10 w-full rounded border border-slate-200 bg-white px-3 text-sm focus:border-teal-500 focus:outline-none disabled:bg-slate-100"
                            />
                            {overseasError && (
                              <p id={`${overseasId}-error`} className="text-xs text-red-600">
                                {overseasError}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {currentStatus === "fulfilment" && (
              <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div>
                  <p className="text-sm font-medium text-slate-800">Completed photos</p>
                  <p className="text-xs text-slate-500">
                    Upload one or more photos of the finished installation.
                  </p>
                </div>
                <CompletionPhotoUploader
                  orderId={orderId}
                  photos={completionPhotos}
                  onUploadingChange={setPhotoUploading}
                />
              </div>
            )}
            <label htmlFor="advance-note" className="block text-xs font-medium text-slate-600">
              Note (optional)
            </label>
            <textarea
              id="advance-note"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={trackingMode ? "Optional handover note" : undefined}
              className="w-full px-3 py-2 border border-slate-200 rounded text-sm focus:outline-none focus:border-teal-500 bg-white"
            />
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={pending || photoUploading}
                className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-900"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={pending || photoUploading}
                className="px-4 py-1.5 text-sm bg-teal-600 hover:bg-teal-700 disabled:bg-slate-300 text-white rounded font-medium"
              >
                {photoUploading
                  ? "Uploading photos…"
                  : pending
                    ? "Saving…"
                    : directOnlyLocalStep
                      ? "Continue — direct shipments"
                      : trackingMode === "local"
                        ? "Save numbers & mark sent"
                      : trackingMode === "overseas"
                        ? "Save numbers & mark shipping"
                        : (ctaLabel ?? "Advance")}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
