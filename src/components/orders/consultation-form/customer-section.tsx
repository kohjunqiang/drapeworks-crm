"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Controller, useFormContext, useWatch } from "react-hook-form";
import { toast } from "sonner";

import { PhoneInput } from "@/components/forms/phone-input";
import { FormSelect } from "@/components/ui/app-select";
import { setConsultationCustomer } from "@/lib/actions/consultation-selection";

import type { ConsultationShellShape } from "./form-shapes";
import {
  clearCreateFormDrafts,
  draftChildKey,
  popCustomerNotice,
  stashCustomerNotice,
} from "./use-form-draft";

export type CustomerLeadOption = {
  leadId: string;
  leadName: string;
  mobile: string | null;
  development: string | null;
};

export type ExistingCustomerOption = {
  customerId: string;
  customerName: string;
  mobile: string | null;
  development: string | null;
};

type Props = {
  /**
   * This form's sessionStorage draft identity (from formDraftKey). The phone
   * country selector's remembered choice lives nested under it, so it is
   * scoped to this exact create/order and cleared with the draft lifecycle.
   */
  draftKey: string;
  /** Present only on a new consultation. Edit mode keeps the normal name input. */
  leadOptions?: CustomerLeadOption[];
  customerOptions?: ExistingCustomerOption[];
  selectedLeadId?: string;
  selectedCustomerId?: string;
};

const INPUT_CLS =
  "w-full px-3 py-2 border border-slate-200 rounded text-sm focus:outline-none focus:border-teal-500 bg-white";

const SALUTATION_PRESETS = ["Mr", "Mrs", "Ms", "Dr"] as const;

// Optional title, kept separate from the name. Four presets plus a free-text
// custom entry (Zoho Books caps salutation at 25 chars — the schema and the
// input both enforce that). No default is ever guessed.
function SalutationField() {
  const { control, register, setValue } =
    useFormContext<ConsultationShellShape>();
  const value = useWatch({ control, name: "customer.salutation" });
  const [customMode, setCustomMode] = useState(
    () =>
      Boolean(value) &&
      !SALUTATION_PRESETS.includes(
        value as (typeof SALUTATION_PRESETS)[number],
      ),
  );
  const isCustom =
    customMode ||
    (Boolean(value) &&
      !SALUTATION_PRESETS.includes(
        value as (typeof SALUTATION_PRESETS)[number],
      ));
  const selectValue = isCustom ? "custom" : (value ?? "");

  return (
    <div className="mb-3">
      <label
        htmlFor="customer-salutation"
        className="block text-xs font-medium text-slate-600 mb-1"
      >
        Title <span className="font-normal text-slate-400">(optional)</span>
      </label>
      <select
        id="customer-salutation"
        value={selectValue}
        onChange={(event) => {
          const next = event.target.value;
          if (next === "custom") {
            setCustomMode(true);
            if (!isCustom) {
              setValue("customer.salutation", "", { shouldDirty: true });
            }
            return;
          }
          setCustomMode(false);
          setValue("customer.salutation", next, { shouldDirty: true });
        }}
        className={`${INPUT_CLS} min-h-11`}
      >
        <option value="">No title</option>
        {SALUTATION_PRESETS.map((preset) => (
          <option key={preset} value={preset}>
            {preset}
          </option>
        ))}
        <option value="custom">Custom…</option>
      </select>
      {isCustom && (
        <input
          type="text"
          maxLength={25}
          placeholder="e.g. Mdm, Prof"
          aria-label="Custom title"
          className={`${INPUT_CLS} mt-2 min-h-11`}
          {...register("customer.salutation")}
        />
      )}
    </div>
  );
}

// Typed to the shared customer+order prefix, not to either product's full
// schema, so it can be dropped into the curtain or the mesh form without
// claiming to know what the line items are. register/errors come from context
// for the same reason — props typed to one schema wouldn't accept the other.
export function CustomerSection({
  draftKey,
  leadOptions,
  customerOptions = [],
  selectedLeadId,
  selectedCustomerId,
}: Props) {
  const searchParams = useSearchParams();
  const {
    control,
    register,
    formState: { errors, isDirty },
  } = useFormContext<ConsultationShellShape>();
  const [isChangingCustomer, startCustomerChange] = useTransition();
  // New consultations always receive this prop, even when no booked lead is
  // currently eligible. Keep the picker visible in that empty state so it
  // does not look as though lead selection has disappeared from the form.
  const choosingCustomer = leadOptions !== undefined;
  const loadedLabel = selectedLeadId
    ? leadOptions?.find((option) => option.leadId === selectedLeadId)?.leadName
    : customerOptions.find((option) => option.customerId === selectedCustomerId)
        ?.customerName;
  // Keep a neutral loaded-state option selected. The actual customer remains
  // available below it, so choosing the same person again is a real value
  // change and reliably reloads their latest order template.
  const selectedOption = selectedLeadId || selectedCustomerId
    ? "loaded-customer"
    : "brand-new";
  const product = searchParams.get("product") === "mesh" ? "mesh" : "curtain";
  // One-shot explanation surfaced after the safe reload that follows a stale
  // pick — a toast fired before navigation would never be seen. Consumed after
  // mount (never during SSR/hydration, where sessionStorage is absent) and
  // inside the scheduled callback: a StrictMode-cancelled first effect must
  // not have already eaten the stored notice.
  const [customerNotice, setCustomerNotice] = useState<string | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => {
      const message = popCustomerNotice(product);
      if (message) setCustomerNotice(message);
    }, 0);
    return () => clearTimeout(timer);
  }, [product]);

  function confirmReset(): boolean {
    return !isDirty || window.confirm("Changing customer will reset this consultation. Continue?");
  }

  function selectCustomer(value: string) {
    if (!confirmReset()) return;

    const params = new URLSearchParams(searchParams.toString());
    params.delete("appointmentId");
    params.delete("leadId");
    params.delete("customerId");
    if (value.startsWith("lead:")) params.set("leadId", value.slice(5));
    const customerId = value.startsWith("customer:") ? value.slice(9) : null;
    startCustomerChange(async () => {
      try {
        const result = await setConsultationCustomer({ product, customerId });
        // A customer can turn ineligible between render and pick (deposit just
        // recorded). The action already cleared the cookie; stash the reason so
        // it survives the reload that re-gates the form.
        if (result && !result.ok) stashCustomerNotice(product, result.error);
        // Draft clearing is destructive — only run it once the pick actually
        // went through and navigation is about to happen. A failed action
        // keeps every in-progress draft.
        clearCreateFormDrafts(product);
        const query = params.toString();
        const target = query ? `/orders/new?${query}` : "/orders/new";
        const current = `${window.location.pathname}${window.location.search}`;
        if (current === target) window.location.reload();
        else window.location.assign(target);
      } catch {
        toast.error("Couldn't update the customer selection. Please try again.");
      }
    });
  }

  return (
    <section className="bg-white rounded-lg border border-slate-200 p-4 sm:p-6 mb-4">
      <h2 className="text-base font-semibold text-slate-900 mb-4">
        Customer details
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
        <div>
          <SalutationField />
          <label
            htmlFor={choosingCustomer ? "consultation-customer" : "customer-name"}
            className="block text-xs font-medium text-slate-600 mb-1"
          >
            {choosingCustomer ? "Customer / Lead" : "Customer Name"}{" "}
            <span className="text-red-500">*</span>
          </label>
          {choosingCustomer ? (
            <>
              <select
                id="consultation-customer"
                value={selectedOption}
                onChange={(event) => selectCustomer(event.target.value)}
                disabled={isChangingCustomer}
                aria-describedby="customer-picker-hint"
                className={`${INPUT_CLS} min-h-11 disabled:cursor-wait disabled:bg-slate-50`}
              >
                {(selectedLeadId || selectedCustomerId) && (
                  <option value="loaded-customer" disabled>
                    {loadedLabel ? `${loadedLabel} — loaded` : "Customer loaded"}
                  </option>
                )}
                {leadOptions.length > 0 && (
                  <optgroup label="Appointment leads">
                    {leadOptions.map((option) => (
                      <option key={option.leadId} value={`lead:${option.leadId}`}>
                        {[option.leadName, option.mobile, option.development]
                          .filter(Boolean)
                          .join(" · ")}
                      </option>
                    ))}
                  </optgroup>
                )}
                {customerOptions.length > 0 && (
                  <optgroup label="Existing customers">
                    {customerOptions.map((option) => (
                      <option
                        key={option.customerId}
                        value={`customer:${option.customerId}`}
                      >
                        {[option.customerName, option.mobile, option.development]
                          .filter(Boolean)
                          .join(" · ")}
                      </option>
                    ))}
                  </optgroup>
                )}
                <option value="brand-new">Brand new customer</option>
              </select>
              {customerNotice && (
                <p role="alert" className="mt-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  {customerNotice}
                </p>
              )}
              <p id="customer-picker-hint" className="mt-1 text-xs text-slate-500">
                Choose a booked lead, reuse a customer whose order is still awaiting deposit, or add a new customer. Choosing the loaded customer again refreshes their latest consultation.
              </p>
              <div className="mt-2">
                <label htmlFor="customer-name" className="block text-xs font-medium text-slate-600 mb-1">
                  {selectedLeadId || selectedCustomerId
                    ? "Customer name"
                    : "New customer name"}
                </label>
                <input
                  id="customer-name"
                  type="text"
                  placeholder="Enter customer name"
                  aria-invalid={errors.customer?.name ? true : undefined}
                  aria-describedby={errors.customer?.name ? "customer-name-error" : undefined}
                  className={`${INPUT_CLS} min-h-11`}
                  {...register("customer.name")}
                />
              </div>
              {isChangingCustomer && (
                <p role="status" className="mt-1 text-xs text-slate-500">
                  Loading customer…
                </p>
              )}
            </>
          ) : (
            <input
              id="customer-name"
              type="text"
              placeholder="e.g. Tan Wei Ming"
              aria-invalid={errors.customer?.name ? true : undefined}
              aria-describedby={errors.customer?.name ? "customer-name-error" : undefined}
              className={`${INPUT_CLS} min-h-11`}
              {...register("customer.name")}
            />
          )}
          {errors.customer?.name && (
            <p id="customer-name-error" className="mt-1 text-xs text-red-600">
              {errors.customer.name.message}
            </p>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label
              htmlFor="customer-mobile"
              className="block text-xs font-medium text-slate-600 mb-1"
            >
              Mobile <span className="text-red-500">*</span>
            </label>
            <Controller
              control={control}
              name="customer.mobile"
              render={({ field }) => (
                <PhoneInput
                  id="customer-mobile"
                  inputRef={field.ref}
                  value={field.value ?? ""}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  placeholder="9123 4567"
                  label="Mobile"
                  persistKey={draftChildKey(draftKey, "customer-mobile-country")}
                  inputClassName={INPUT_CLS}
                  selectClassName={INPUT_CLS}
                  aria-invalid={errors.customer?.mobile ? true : undefined}
                  aria-describedby={
                    errors.customer?.mobile ? "customer-mobile-error" : undefined
                  }
                />
              )}
            />
            {errors.customer?.mobile && (
              <p id="customer-mobile-error" className="mt-1 text-xs text-red-600">
                {errors.customer.mobile.message}
              </p>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Email
            </label>
            <input
              type="email"
              placeholder="name@email.com"
              className={INPUT_CLS}
              {...register("customer.email")}
            />
            {errors.customer?.email && (
              <p className="mt-1 text-xs text-red-600">
                {errors.customer.email.message}
              </p>
            )}
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Property Type
          </label>
          <FormSelect
            control={control}
            name="order.property_type"
            noneLabel="—"
            options={[
              { value: "HDB", label: "HDB" },
              { value: "Condo", label: "Condo" },
              { value: "Landed", label: "Landed" },
              { value: "Commercial", label: "Commercial" },
            ]}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Development
          </label>
          <input
            type="text"
            placeholder="e.g. Parc Esta"
            className={INPUT_CLS}
            {...register("order.development")}
          />
        </div>
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Installation Address <span className="text-red-500">*</span>
          </label>
          <textarea
            rows={2}
            placeholder="Block, street, unit number and postal code"
            required
            className={INPUT_CLS}
            {...register("order.site_address")}
          />
          {errors.order?.site_address && (
            <p className="mt-1 text-xs text-red-600">{errors.order.site_address.message}</p>
          )}
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Unit Type
          </label>
          <input
            type="text"
            placeholder="e.g. 4-room, 3 Bedroom"
            className={INPUT_CLS}
            {...register("order.unit_type")}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Expected Move-in Date
          </label>
          <input
            type="date"
            className={INPUT_CLS}
            {...register("order.move_in_date")}
          />
        </div>
      </div>
    </section>
  );
}
