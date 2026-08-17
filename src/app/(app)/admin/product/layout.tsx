import type { ReactNode } from "react";

import { ProductTabs } from "@/components/admin/product-tabs";
import { requireRole } from "@/lib/auth/require-role";

// Chrome for the whole Product section. The role guard sits here so every tab
// underneath inherits it; each page still guards its own Server Actions, which
// is where access control actually has to hold.

export const metadata = { title: "Product — Drapeworks CRM" };

export default async function ProductLayout({
  children,
}: {
  children: ReactNode;
}) {
  await requireRole(["admin"]);

  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <h1 className="text-xl sm:text-2xl font-bold text-slate-900 mb-4">
        Product
      </h1>
      <ProductTabs />
      {children}
    </main>
  );
}
