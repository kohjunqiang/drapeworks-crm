"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";

import { AppSelect } from "@/components/ui/app-select";
import { STATUS_FLOW, STATUS_LABELS } from "@/lib/status-flow";
import type { FulfilmentStatus } from "@/lib/db/schema";

type Consultant = { id: string; label: string };

type Props = {
  defaults: {
    q?: string;
    status?: string;
    consultant?: string;
    product?: string;
  };
  consultants: Consultant[];
};

const INPUT_CLS =
  "px-3 py-2 border border-slate-200 rounded text-sm focus:outline-none focus:border-teal-500 bg-white";

function buildHref(
  base: string,
  next: { q: string; status: string; consultant: string; product: string },
): string {
  const params = new URLSearchParams();
  if (next.q) params.set("q", next.q);
  if (next.status) params.set("status", next.status);
  if (next.consultant) params.set("consultant", next.consultant);
  if (next.product) params.set("product", next.product);
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

export function OrdersFilters({ defaults, consultants }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [, startTransition] = useTransition();

  const [q, setQ] = useState(defaults.q ?? "");
  const [status, setStatus] = useState(defaults.status ?? "");
  const [consultant, setConsultant] = useState(defaults.consultant ?? "");
  const [product, setProduct] = useState(defaults.product ?? "");

  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      startTransition(() => {
        router.push(buildHref(pathname, { q, status, consultant, product }));
      });
    }, 300);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, status, consultant, product]);

  return (
    <div className="bg-white rounded-lg border border-slate-200 mb-4 p-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search by customer, development, or order #"
        className={`flex-1 ${INPUT_CLS}`}
      />
      <div className="grid grid-cols-1 sm:flex gap-2 sm:gap-3">
        <AppSelect
          value={status}
          onChange={setStatus}
          noneLabel="All statuses"
          triggerClassName="w-full sm:w-44"
          options={STATUS_FLOW.map((s: FulfilmentStatus) => ({
            value: s,
            label: STATUS_LABELS[s],
          }))}
        />
        <AppSelect
          value={consultant}
          onChange={setConsultant}
          noneLabel="All consultants"
          triggerClassName="w-full sm:w-44"
          options={consultants.map((c) => ({ value: c.id, label: c.label }))}
        />
        <AppSelect
          value={product}
          onChange={setProduct}
          noneLabel="All products"
          triggerClassName="w-full sm:w-36"
          options={[
            { value: "curtain", label: "Curtains" },
            { value: "mesh", label: "Mesh" },
          ]}
        />
      </div>
    </div>
  );
}
