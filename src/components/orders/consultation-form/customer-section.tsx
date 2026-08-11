"use client";

import { useFormContext } from "react-hook-form";

import { FormSelect } from "@/components/ui/app-select";

import type { ConsultationShellShape } from "./form-shapes";

const INPUT_CLS =
  "w-full px-3 py-2 border border-slate-200 rounded text-sm focus:outline-none focus:border-teal-500 bg-white";

// Typed to the shared customer+order prefix, not to either product's full
// schema, so it can be dropped into the curtain or the mesh form without
// claiming to know what the line items are. register/errors come from context
// for the same reason — props typed to one schema wouldn't accept the other.
export function CustomerSection() {
  const {
    control,
    register,
    formState: { errors },
  } = useFormContext<ConsultationShellShape>();
  return (
    <section className="bg-white rounded-lg border border-slate-200 p-4 sm:p-6 mb-4">
      <h2 className="text-base font-semibold text-slate-900 mb-4">
        Customer details
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Customer Name <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            placeholder="e.g. Tan Wei Ming"
            className={INPUT_CLS}
            {...register("customer.name")}
          />
          {errors.customer?.name && (
            <p className="mt-1 text-xs text-red-600">
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
