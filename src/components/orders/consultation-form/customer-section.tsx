"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { useFormContext } from "react-hook-form";

import { FormSelect } from "@/components/ui/app-select";

import type { ConsultationShellShape } from "./form-shapes";

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
  /** Present only on a new consultation. Edit mode keeps the normal name input. */
  leadOptions?: CustomerLeadOption[];
  customerOptions?: ExistingCustomerOption[];
  selectedLeadId?: string;
  selectedCustomerId?: string;
};

const INPUT_CLS =
  "w-full px-3 py-2 border border-slate-200 rounded text-sm focus:outline-none focus:border-teal-500 bg-white";

// Typed to the shared customer+order prefix, not to either product's full
// schema, so it can be dropped into the curtain or the mesh form without
// claiming to know what the line items are. register/errors come from context
// for the same reason — props typed to one schema wouldn't accept the other.
export function CustomerSection({
  leadOptions,
  customerOptions = [],
  selectedLeadId,
  selectedCustomerId,
}: Props) {
  const router = useRouter();
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
  const selectedOption = selectedLeadId
    ? `lead:${selectedLeadId}`
    : selectedCustomerId
      ? `customer:${selectedCustomerId}`
      : "brand-new";

  function selectCustomer(value: string) {
    if (
      isDirty &&
      !window.confirm("Changing customer will reset this consultation. Continue?")
    ) return;

    const params = new URLSearchParams(searchParams.toString());
    params.delete("appointmentId");
    params.delete("leadId");
    params.delete("customerId");
    if (value.startsWith("lead:")) params.set("leadId", value.slice(5));
    if (value.startsWith("customer:")) params.set("customerId", value.slice(9));
    startCustomerChange(() => router.push(`/orders/new?${params.toString()}`));
  }

  return (
    <section className="bg-white rounded-lg border border-slate-200 p-4 sm:p-6 mb-4">
      <h2 className="text-base font-semibold text-slate-900 mb-4">
        Customer details
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
        <div>
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
              <p id="customer-picker-hint" className="mt-1 text-xs text-slate-500">
                Choose a booked lead, reuse a customer from a recorded order, or add a new customer.
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
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Mobile <span className="text-red-500">*</span>
            </label>
            <input
              type="tel"
              placeholder="+65"
              className={INPUT_CLS}
              {...register("customer.mobile")}
            />
            {errors.customer?.mobile && (
              <p className="mt-1 text-xs text-red-600">
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
