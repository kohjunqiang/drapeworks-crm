"use client";

import { useRouter, useSearchParams } from "next/navigation";

export type ConsultationLeadOption = {
  leadId: string;
  leadName: string;
  mobile: string | null;
  development: string | null;
};

export function LeadConsultationPicker({ options, selectedId }: { options: ConsultationLeadOption[]; selectedId?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  return (
    <section className="mb-5 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <label htmlFor="consultation-lead" className="block text-sm font-semibold text-slate-800">Customer from Leads</label>
      <p className="mt-1 text-xs text-slate-500">Select a customer at Attend Appointment to prefill the consultation and keep the order linked to its lead.</p>
      <select
        id="consultation-lead"
        value={selectedId ?? ""}
        onChange={event => {
          const params = new URLSearchParams(searchParams.toString());
          params.delete("appointmentId");
          if (event.target.value) params.set("leadId", event.target.value);
          else params.delete("leadId");
          router.push(`/orders/new?${params.toString()}`);
        }}
        className="mt-3 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
      >
        <option value="">Select customer</option>
        {options.map(option => (
          <option key={option.leadId} value={option.leadId}>
            {[option.leadName, option.mobile || "No customer number", option.development].filter(Boolean).join(" · ")}
          </option>
        ))}
      </select>
    </section>
  );
}
