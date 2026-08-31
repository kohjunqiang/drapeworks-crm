"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const TABS = [
  { href: "/admin/pricing-settings/curtains", label: "Curtains" },
  { href: "/admin/pricing-settings/blinds", label: "Blinds" },
  { href: "/admin/pricing-settings/mesh", label: "Mesh" },
  { href: "/admin/pricing-settings/shared", label: "Shared assumptions" },
];

export function PricingTabs() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Pricing product line"
      className="-mx-1 flex gap-1 overflow-x-auto border-b border-slate-200 px-1"
    >
      {TABS.map((tab) => {
        const active = pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "min-h-11 whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium",
              active
                ? "border-teal-600 text-teal-700"
                : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
