"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import type { SessionData } from "@/lib/auth/get-session";

import { MobileMenu } from "./mobile-menu";
import { UserMenu } from "./user-menu";

const baseLinks = [
  {
    href: "/orders",
    label: "Orders",
    match: (p: string) =>
      p === "/orders" ||
      (p.startsWith("/orders/") && !p.startsWith("/orders/new")),
  },
  {
    href: "/orders/new",
    label: "New Consultation",
    match: (p: string) => p === "/orders/new",
  },
  {
    href: "/admin/digital-catalogue",
    label: "Digital Catalogue",
    match: (p: string) => p.startsWith("/admin/digital-catalogue"),
    adminOnly: true,
  },
  {
    href: "/admin/vendors",
    label: "Vendors",
    match: (p: string) => p.startsWith("/admin/vendors"),
    adminOnly: true,
  },
  {
    href: "/admin/mesh",
    label: "Mesh",
    match: (p: string) => p.startsWith("/admin/mesh"),
    adminOnly: true,
  },
  {
    href: "/admin/pricing-settings",
    label: "Pricing",
    match: (p: string) => p.startsWith("/admin/pricing-settings"),
    adminOnly: true,
  },
];

type Props = {
  profile: SessionData["profile"];
};

export function TopNav({ profile }: Props) {
  const pathname = usePathname();
  const canCreate = profile.role === "consultant" || profile.role === "admin";
  const isAdmin = profile.role === "admin";
  const links = baseLinks.filter(
    (l) =>
      (l.href !== "/orders/new" || canCreate) && (!l.adminOnly || isAdmin),
  );

  return (
    <nav className="bg-white border-b border-slate-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4 md:gap-8">
          <Link href="/orders" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded bg-teal-600 flex items-center justify-center text-white font-bold">
              D
            </div>
            <span className="font-semibold text-slate-900 text-sm sm:text-base">
              Drapeworks CRM
            </span>
          </Link>
          <div className="hidden md:flex items-center gap-1 text-sm">
            {links.map((l) => {
              const active = l.match(pathname);
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  className={
                    active
                      ? "px-3 py-1.5 rounded bg-slate-100 text-slate-900 font-medium"
                      : "px-3 py-1.5 rounded text-slate-600 hover:bg-slate-100"
                  }
                >
                  {l.label}
                </Link>
              );
            })}
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <UserMenu profile={profile} />
          <MobileMenu role={profile.role} />
        </div>
      </div>
    </nav>
  );
}
