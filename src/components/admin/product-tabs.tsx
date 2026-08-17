"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Sub-navigation for the Product section. Each tab is a real route rather than
// client-side state, so links, refresh and back all behave, and each catalogue
// stays a Server Component that loads only its own data.

const TABS = [
  { href: "/admin/product/curtains", label: "Curtains" },
  { href: "/admin/product/blinds", label: "Blinds" },
  { href: "/admin/product/mesh", label: "Mesh" },
];

export function ProductTabs() {
  const pathname = usePathname();

  return (
    <div className="border-b border-slate-200 mb-6">
      <nav className="-mb-px flex gap-1 overflow-x-auto" aria-label="Product">
        {TABS.map((t) => {
          const active = pathname.startsWith(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? "page" : undefined}
              className={
                active
                  ? "px-4 py-2.5 text-sm font-medium text-teal-700 border-b-2 border-teal-600 whitespace-nowrap"
                  : "px-4 py-2.5 text-sm text-slate-500 border-b-2 border-transparent hover:text-slate-700 hover:border-slate-300 whitespace-nowrap"
              }
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
