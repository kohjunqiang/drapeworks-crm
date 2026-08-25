"use client";

import { useState, useTransition } from "react";
import { Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { searchCustomers } from "@/lib/actions/leads";

export type CustomerChoice =
  | { mode: "existing"; customer_id: string; label: string }
  | { mode: "new"; name: string; mobile: string };

// Taken from the action rather than restated. order_count comes back as a
// bigint, which node-pg does NOT parse — it arrives as a string at runtime even
// though the column is numeric. Every use goes through Number().
type Match = Awaited<ReturnType<typeof searchCustomers>>[number];

export function CustomerPicker({
  defaultName,
  defaultMobile,
  value,
  onChange,
}: {
  defaultName: string;
  defaultMobile: string | null;
  value: CustomerChoice;
  onChange: (choice: CustomerChoice) => void;
}) {
  const [term, setTerm] = useState(defaultMobile ?? defaultName);
  const [matches, setMatches] = useState<Match[]>([]);
  const [searched, setSearched] = useState(false);
  const [pending, start] = useTransition();

  function search() {
    start(async () => {
      setMatches(await searchCustomers(term));
      setSearched(true);
    });
  }

  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        Customer
      </p>

      <div className="mt-2 flex gap-2">
        <Label htmlFor="customer-search" className="sr-only">
          Search customers
        </Label>
        <Input
          id="customer-search"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          // Enter inside a dialog form would submit the booking instead of
          // running the search the consultant is plainly in the middle of.
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              search();
            }
          }}
          placeholder="Search by mobile or name"
          className="h-9 border-slate-200"
        />
        <Button
          type="button"
          variant="outline"
          size="lg"
          onClick={search}
          disabled={pending || term.trim().length < 2}
        >
          <Search aria-hidden />
          {pending ? "…" : "Search"}
        </Button>
      </div>

      {searched && matches.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {matches.map((m) => {
            const selected =
              value.mode === "existing" && value.customer_id === m.id;
            const orders = Number(m.order_count);
            return (
              <li key={m.id}>
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() =>
                    onChange({
                      mode: "existing",
                      customer_id: m.id,
                      label: `${m.name} · ${m.mobile}`,
                    })
                  }
                  className={`w-full rounded-md border px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-teal-600/50 ${
                    selected
                      ? "border-teal-600 bg-teal-50"
                      : "border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  <span className="font-medium text-slate-900">{m.name}</span>
                  <span className="text-slate-500"> · {m.mobile}</span>
                  {/* Duplicate names are common; the order count disambiguates. */}
                  <span className="ml-2 text-xs text-slate-400">
                    {orders} order{orders === 1 ? "" : "s"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      {searched && matches.length === 0 ? (
        <p className="mt-2 text-xs text-slate-500">
          No existing customer matched — a new one will be created.
        </p>
      ) : null}

      <button
        type="button"
        aria-pressed={value.mode === "new"}
        onClick={() =>
          onChange({
            mode: "new",
            name: defaultName,
            mobile: defaultMobile ?? "",
          })
        }
        className={`mt-2 w-full rounded-md border px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-teal-600/50 ${
          value.mode === "new"
            ? "border-teal-600 bg-teal-50"
            : "border-slate-200 hover:bg-slate-50"
        }`}
      >
        Create new customer from this lead
      </button>

      {value.mode === "new" ? (
        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <Label
              htmlFor="customer-name"
              className="text-xs font-medium uppercase tracking-wide text-slate-500"
            >
              Name
            </Label>
            <Input
              id="customer-name"
              value={value.name}
              onChange={(e) => onChange({ ...value, name: e.target.value })}
              required
              className="mt-1 h-9 border-slate-200"
            />
          </div>
          <div>
            {/* 146 of 244 leads have no mobile, and customers.mobile is NOT
                NULL — for most leads this is a field the consultant has to fill
                in at booking, not one that carries over. Marked required here
                so the browser says so before the server action has to. */}
            <Label
              htmlFor="customer-mobile"
              className="text-xs font-medium uppercase tracking-wide text-slate-500"
            >
              Mobile <span className="text-red-600">*</span>
            </Label>
            <Input
              id="customer-mobile"
              value={value.mobile}
              onChange={(e) => onChange({ ...value, mobile: e.target.value })}
              placeholder="e.g. 9843 9326"
              required
              className="mt-1 h-9 border-slate-200"
            />
          </div>
        </div>
      ) : (
        <p className="mt-2 text-xs text-slate-600">
          Booking as <span className="font-medium">{value.label}</span>.
        </p>
      )}
    </div>
  );
}
