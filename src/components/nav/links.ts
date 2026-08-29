import type { Role } from "@/lib/auth/get-session";

// One list, two menus. top-nav and mobile-menu previously carried near-duplicate
// arrays, which is exactly how the two drift apart on the next product line —
// Phase 12 would have meant making the same edit twice.

export type NavLink = {
  href: string;
  label: string;
  roles?: Role[];
  /** Whether a given pathname should light this item up. */
  match: (pathname: string) => boolean;
};

export const NAV_LINKS: NavLink[] = [
  {
    href: "/queue",
    label: "Queue",
    roles: ["consultant", "admin"],
    match: (p) => p.startsWith("/queue"),
  },
  {
    // The front of the funnel. Everything else in this nav starts after a
    // customer has already said yes.
    href: "/leads",
    label: "Leads",
    roles: ["consultant", "admin"],
    match: (p) => p.startsWith("/leads"),
  },
  {
    href: "/orders",
    label: "Orders",
    match: (p) =>
      p === "/orders" || (p.startsWith("/orders/") && !p.startsWith("/orders/new")),
  },
  {
    href: "/orders/new",
    label: "New Consultation",
    roles: ["consultant", "admin"],
    match: (p) => p === "/orders/new",
  },
  {
    // Curtains, blinds and mesh all live here — one section, three tabs.
    href: "/admin/product",
    label: "Product",
    roles: ["admin"],
    match: (p) => p.startsWith("/admin/product"),
  },
  {
    href: "/admin/vendors",
    label: "Vendors",
    roles: ["admin"],
    match: (p) => p.startsWith("/admin/vendors"),
  },
  {
    href: "/admin/pricing-settings",
    label: "Pricing",
    roles: ["admin"],
    match: (p) => p.startsWith("/admin/pricing-settings"),
  },
  {
    // The Chinese labels and company block a purchase order is built from.
    href: "/admin/procurement",
    label: "Procurement",
    roles: ["admin"],
    match: (p) => p.startsWith("/admin/procurement"),
  },
];

export function linksForRole(role: Role): NavLink[] {
  return NAV_LINKS.filter((l) => !l.roles || l.roles.includes(role));
}
