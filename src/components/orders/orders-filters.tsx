"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";

import { STATUS_FLOW, STATUS_LABELS } from "@/lib/status-flow";
import type { FulfilmentStatus } from "@/lib/db/schema";

type Props = {
  defaults: {
    q?: string;
    status?: string;
  };
};

const INPUT_CLS =
  "px-3 py-2 border border-slate-200 rounded text-sm focus:outline-none focus:border-teal-500 bg-white";

function buildHref(
  base: string,
  next: { q: string; status: string },
): string {
  const params = new URLSearchParams();
  if (next.q) params.set("q", next.q);
  if (next.status) params.set("status", next.status);
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

export function OrdersFilters({ defaults }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [, startTransition] = useTransition();

  const [q, setQ] = useState(defaults.q ?? "");
  const [status, setStatus] = useState(defaults.status ?? "");

  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      startTransition(() => {
        router.push(buildHref(pathname, { q, status }));
      });
    }, 300);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, status]);

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
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className={INPUT_CLS}
        >
          <option value="">All statuses</option>
          {STATUS_FLOW.map((s: FulfilmentStatus) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
