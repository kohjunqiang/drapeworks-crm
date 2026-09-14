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
    sort?: string;
    dir?: string;
  };
  consultants: Consultant[];
};

const INPUT_CLS =
  "px-3 py-2 border border-slate-200 rounded text-sm focus:outline-none focus:border-teal-500 bg-white";

function buildHref(
  base: string,
  next: {
    q: string;
    status: string;
    consultant: string;
    product: string;
    sort?: string;
    dir?: string;
  },
): string {
  const params = new URLSearchParams();
  if (next.q) params.set("q", next.q);
  if (next.status) params.set("status", next.status);
  if (next.consultant) params.set("consultant", next.consultant);
  if (next.product) params.set("product", next.product);
  if (next.sort) params.set("sort", next.sort);
  if (next.dir) params.set("dir", next.dir);
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

export function OrdersFilters({ defaults, consultants }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [, startTransition] = useTransition();

  const [q, setQ] = useState(defaults.q ?? "");
  const [serverQ, setServerQ] = useState(defaults.q ?? "");
  const [submittedQueries, setSubmittedQueries] = useState<string[]>([]);
  const [navigationReset, setNavigationReset] = useState(0);

  // An acknowledgement of our own search must not overwrite newer typing.
  // A link or history navigation should restore the query in the destination.
  const incomingQ = defaults.q ?? "";
  if (incomingQ !== serverQ) {
    setServerQ(incomingQ);
    const submittedIndex = submittedQueries.indexOf(incomingQ);
    if (submittedIndex < 0) {
      setQ(incomingQ);
      setSubmittedQueries([]);
      setNavigationReset(navigationReset + 1);
    } else {
      setSubmittedQueries(submittedQueries.slice(submittedIndex + 1));
    }
  }
  const [status, setStatus] = useState(defaults.status ?? "");
  const [consultant, setConsultant] = useState(defaults.consultant ?? "");
  const [product, setProduct] = useState(defaults.product ?? "");

  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cancel an unsent search when a link takes us to a different query.
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
  }, [navigationReset]);

  // Search updates must preserve the input node and any newer typing. Browser
  // history navigation, however, should restore the query from that URL.
  useEffect(() => {
    function restoreSearch() {
      if (debounce.current) clearTimeout(debounce.current);
      setSubmittedQueries([]);
      setQ(new URLSearchParams(window.location.search).get("q") ?? "");
    }
    window.addEventListener("popstate", restoreSearch);
    return () => window.removeEventListener("popstate", restoreSearch);
  }, []);

  useEffect(() => () => {
    if (debounce.current) clearTimeout(debounce.current);
  }, []);

  function scheduleSearch(next: {
    q: string;
    status: string;
    consultant: string;
    product: string;
  }) {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      setSubmittedQueries((queries) => [...queries, next.q]);
      startTransition(() => {
        router.push(buildHref(pathname, {
          ...next,
          sort: defaults.sort,
          dir: defaults.dir,
        }), { scroll: false });
      });
    }, 300);
  }

  return (
    <div className="bg-white rounded-lg border border-slate-200 mb-4 p-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
      <input
        type="text"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          scheduleSearch({ q: e.target.value, status, consultant, product });
        }}
        placeholder="Search by customer, development, order, or freight #"
        className={`flex-1 ${INPUT_CLS}`}
      />
      <div className="grid grid-cols-1 sm:flex gap-2 sm:gap-3">
        <AppSelect
          value={status}
          onChange={(value) => {
            setStatus(value);
            scheduleSearch({ q, status: value, consultant, product });
          }}
          noneLabel="Current orders"
          triggerClassName="w-full sm:w-44"
          options={STATUS_FLOW.map((s: FulfilmentStatus) => ({
            value: s,
            label: STATUS_LABELS[s],
          }))}
        />
        <AppSelect
          value={consultant}
          onChange={(value) => {
            setConsultant(value);
            scheduleSearch({ q, status, consultant: value, product });
          }}
          noneLabel="All consultants"
          triggerClassName="w-full sm:w-44"
          options={consultants.map((c) => ({ value: c.id, label: c.label }))}
        />
        <AppSelect
          value={product}
          onChange={(value) => {
            setProduct(value);
            scheduleSearch({ q, status, consultant, product: value });
          }}
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
