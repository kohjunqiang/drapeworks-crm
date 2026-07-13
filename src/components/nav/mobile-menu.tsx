"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { signOut } from "@/lib/actions/auth";
import type { Role } from "@/lib/auth/get-session";

const baseLinks = [
  { href: "/orders", label: "Orders" },
  { href: "/orders/new", label: "New Consultation", roles: ["consultant", "admin"] as Role[] },
  {
    href: "/admin/digital-catalogue",
    label: "Digital Catalogue",
    roles: ["admin"] as Role[],
  },
  {
    href: "/admin/vendors",
    label: "Vendors",
    roles: ["admin"] as Role[],
  },
];

type Props = {
  role: Role;
};

export function MobileMenu({ role }: Props) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const allLinks = baseLinks.filter((l) => !l.roles || l.roles.includes(role));

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        aria-label="Open menu"
        className="md:hidden p-1.5 text-slate-600 hover:bg-slate-100 rounded"
      >
        <Menu className="w-5 h-5" />
      </SheetTrigger>
      <SheetContent side="top" className="p-0">
        <SheetHeader className="px-4 py-3 border-b border-slate-200">
          <SheetTitle className="text-base">Menu</SheetTitle>
        </SheetHeader>
        <div className="px-4 py-2 space-y-1">
          {allLinks.map((l) => {
            const active =
              pathname === l.href ||
              (l.href === "/orders" &&
                pathname.startsWith("/orders/") &&
                !pathname.startsWith("/orders/new"));
            return (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className={
                  active
                    ? "block px-3 py-2 rounded bg-slate-100 text-slate-900 font-medium text-sm"
                    : "block px-3 py-2 rounded text-slate-600 hover:bg-slate-100 text-sm"
                }
              >
                {l.label}
              </Link>
            );
          })}
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                await signOut();
              })
            }
            className="block w-full text-left px-3 py-2 rounded text-red-600 hover:bg-red-50 text-sm disabled:opacity-50"
          >
            {pending ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
